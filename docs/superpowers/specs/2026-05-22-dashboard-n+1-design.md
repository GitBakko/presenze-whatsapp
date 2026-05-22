# Dashboard N+1 Elimination — Design (H4)

**Date:** 2026-05-22
**Tech-debt ref:** Gruppo 4 / H4 — Performance & Architettura (sub-phase 1)
**Driver:** `/api/stats/dashboard` esegue ~3N+8 query per ogni hit (N = dipendenti attivi). Su 20 dipendenti = 68+ query serial. Dashboard è la prima pagina che l'admin vede dopo login → impatta perceived performance.

## 1. Decisioni di scope (raccolte in brainstorming)

| Decisione | Scelta |
|-----------|--------|
| Scope | Entrambi: leave balances loop + computeOreChart 8-month loop |
| Strategia | Batch query + in-memory pure compute |
| Testing | Regression test su pure compute function (`computeLeaveBalanceFromData`) con 8 fixture |
| Caching | Escluso (YAGNI — vive in H10 RSC phase) |
| Refactor consumer (payroll-import-service) | Escluso (resta su wrapper, follow-up in M-series) |

## 2. Architettura — 4 layer

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1 — Pure compute extraction                      │
│    computeLeaveBalanceFromData(employee, balance,       │
│      approvedLeaves, now?) → LeaveBalanceSummary        │
│    Sync, deterministic, no DB.                          │
│                                                          │
│  Layer 2 — computeLeaveBalance wrapper                  │
│    Thin DB wrapper: fetch employee+schedule, balance,   │
│    leaves → delega alla pura. API pubblica invariata.   │
│                                                          │
│  Layer 3 — Dashboard route batch                         │
│    Sostituisce 3N serial query con 3 batch query +      │
│    loop in-memory che chiama pura.                      │
│                                                          │
│  Layer 4 — computeOreChart range                        │
│    Sostituisce 8 serial query con 1 range query +       │
│    in-memory grouping per mese.                         │
└─────────────────────────────────────────────────────────┘
```

**Before**: ~3N + 8 query per dashboard hit (N=15-25 → 53-83 query).
**After**: 4 query totali (3 per balances + 1 per ore chart records).
**Aspettativa**: TTFB -60% / -90% su `chart=all`.

## 3. Componenti

### 3.1 `computeLeaveBalanceFromData` (nuovo, in `src/lib/leaves/balance.ts`)

Pure sync function. Estrae tutta la logica di calcolo da `computeLeaveBalance` esistente.

**Signature:**
```typescript
type EmployeeForBalance = {
  id: string;
  hireDate: Date | null;
  contractType: string;
  schedule: Array<{
    dayOfWeek: number;
    block1Start: string | null;
    block1End: string | null;
    block2Start: string | null;
    block2End: string | null;
  }>;
};

type BalanceRow = {
  vacationCarryOver: number;
  rolCarryOver: number;
  vacationAccrualAdjust: number;
  rolAccrualAdjust: number;
} | null;

type LeaveRequestRow = {
  type: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  timeSlots: string | null;
};

export function computeLeaveBalanceFromData(
  employee: EmployeeForBalance,
  balance: BalanceRow,
  approvedLeaves: LeaveRequestRow[],
  year: number,
  now: Date = new Date(),
): LeaveBalanceSummary
```

**Behavior:**
- Tutta la logica esistente di `computeLeaveBalance` da line 130 in poi (calcolo weeklyHours, monthsAccrued, vacationAccrued, rolAccrued, applicazione carry-over + adjust, day-by-day usage da approvedLeaves).
- `now` iniettabile per test deterministici.
- No DB access. No throw (assume input valido — wrapper si occupa di lookup employee).

### 3.2 `computeLeaveBalance` wrapper (refactor, in `src/lib/leaves/balance.ts`)

Diventa thin DB wrapper che delega alla pura.

**Behavior:**
```typescript
export async function computeLeaveBalance(employeeId, year) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { schedule: true },
  });
  if (!employee) throw new Error("Dipendente non trovato");

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const [balance, approvedLeaves] = await Promise.all([
    prisma.leaveBalance.findUnique({ where: { employeeId_year: { employeeId, year } } }),
    prisma.leaveRequest.findMany({
      where: { employeeId, status: "APPROVED", startDate: { gte: yearStart, lte: yearEnd } },
    }),
  ]);

  return computeLeaveBalanceFromData(employee, balance, approvedLeaves, year);
}
```

Consumers (`payroll-import-service.ts` + dashboard route fino a refactor) restano invariati.

### 3.3 Dashboard route batch (refactor, in `src/app/api/stats/dashboard/route.ts`)

**Before (line 378-399):**
```typescript
for (const emp of allEmployees) {
  try {
    const bal = await computeLeaveBalance(emp.id, currentYear);
    leaveBalances.push({ ...derive UI row... });
  } catch { /* skip */ }
}
```

**After:**
```typescript
const empIds = allEmployees.map((e) => e.id);
const yearStart = `${currentYear}-01-01`;
const yearEnd = `${currentYear}-12-31`;

const [balanceRows, leaveRows] = await Promise.all([
  prisma.leaveBalance.findMany({
    where: { employeeId: { in: empIds }, year: currentYear },
  }),
  prisma.leaveRequest.findMany({
    where: {
      employeeId: { in: empIds },
      status: "APPROVED",
      startDate: { gte: yearStart, lte: yearEnd },
    },
  }),
]);

const balanceMap = new Map(balanceRows.map((b) => [b.employeeId, b]));
const leavesByEmp = new Map<string, typeof leaveRows>();
for (const l of leaveRows) {
  const arr = leavesByEmp.get(l.employeeId) ?? [];
  arr.push(l);
  leavesByEmp.set(l.employeeId, arr);
}

for (const emp of allEmployees) {
  try {
    const bal = computeLeaveBalanceFromData(
      emp,
      balanceMap.get(emp.id) ?? null,
      leavesByEmp.get(emp.id) ?? [],
      currentYear,
    );
    leaveBalances.push({ ...derive UI row... });
  } catch { /* skip */ }
}
```

Nota: `allEmployees` deve già includere `schedule` per essere usabile dalla pura. Verifico in plan-phase la query upstream — se non lo fa, aggiungo `include: { schedule: true }`.

### 3.4 `computeOreChart` range refactor (in `src/app/api/stats/dashboard/route.ts`)

**Before:** loop 8 mesi con 1 `attendanceRecord.findMany` per mese.

**After:**
```typescript
const earliestMonth = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
const rangeFrom = `${earliestMonth.getFullYear()}-${String(earliestMonth.getMonth() + 1).padStart(2, "0")}-01`;
const lastMonthLast = new Date(now.getFullYear(), now.getMonth() + 1, 0);
const rangeTo = `${lastMonthLast.getFullYear()}-${String(lastMonthLast.getMonth() + 1).padStart(2, "0")}-${String(lastMonthLast.getDate()).padStart(2, "0")}`;

const recordsWhere: Record<string, unknown> = { date: { gte: rangeFrom, lte: rangeTo } };
if (filterEmployeeId) recordsWhere.employeeId = filterEmployeeId;

const allRecords = await prisma.attendanceRecord.findMany({
  where: recordsWhere,
  include: { employee: true },
  orderBy: [{ date: "asc" }, { declaredTime: "asc" }],
});

// Group per YYYY-MM
const recordsByMonth = new Map<string, typeof allRecords>();
for (const r of allRecords) {
  const ym = r.date.slice(0, 7); // 'YYYY-MM'
  const arr = recordsByMonth.get(ym) ?? [];
  arr.push(r);
  recordsByMonth.set(ym, arr);
}

// Loop mesi resta uguale ma legge da map invece di query
for (let i = months - 1; i >= 0; i--) {
  // ... compute contratto come oggi ...
  const records = recordsByMonth.get(`${y}-${String(m).padStart(2, "0")}`) ?? [];
  // ... rest of grouping + calculateDailyStats come oggi ...
}
```

## 4. Testing

### 4.1 Regression test `src/lib/leaves/balance.test.ts` (nuovo)

8 fixture chiamano `computeLeaveBalanceFromData` direttamente con `now` iniettato:

| # | Fixture | Verifica |
|---|---------|----------|
| 1 | FULL_TIME, hired prev year, 40h/wk, no leaves, no balance, now=mid-anno | `vacationAccrued = monthsAccrued * monthlyVacationAccrual(40)` |
| 2 | FULL_TIME hired June this year, now=Dec same year | `monthsAccrued = 7` (June..December) |
| 3 | PART_TIME 24h/wk con schedule rows, no leaves | accrual proporzionale |
| 4 | PART_TIME no schedule rows | accrual = 0, no throw |
| 5 | Hired prev year, with `vacationCarryOver=10` + `vacationAccrualAdjust=2` | vacationTotal include entrambi |
| 6 | 1 leave VACATION 5 giorni APPROVED in periodo | `vacationUsed = 5` |
| 7 | 1 leave ROL `hours=4` APPROVED | `rolUsed = 4` |
| 8 | 1 leave VACATION_HALF_AM con `timeSlots` JSON | day-by-day usage computed correctly |

### 4.2 Manual equivalence check

Prima del commit finale, eseguire entrambe le versioni (HEAD pre-refactor + post-refactor) contro stesso dev DB:
- `curl /api/stats/dashboard?period=month&chart=all` (admin session)
- Diff payload via `jq -S`. Atteso: 0 diff.

Non commit baseline JSON nel repo (cambia troppo con dev DB).

### 4.3 Perf measurement

- Aggiungi `console.time/timeEnd("dashboard")` temporaneo nell'handler durante development.
- Dev DB locale (~15 employees): documenta TTFB before vs after in commit message.
- Rimuovi `console.time` prima del commit finale.

## 5. Error handling

- `computeLeaveBalanceFromData` no-throw su input valido. Se employee con schedule degenere arriva, restituisce summary con zeri (mantiene comportamento attuale del try/catch nel loop).
- Query batch fallisce → propagate al chiamante (route handler già usa try/catch upstream).
- Records range query restituisce 0 record per un mese → quel mese ha `lavorate = 0` (comportamento esistente preservato).

## 6. Scope esclusioni (YAGNI esplicite)

- ❌ next/cache o in-memory dashboard cache (vive in H10).
- ❌ Indici DB nuovi (verifica in plan-phase se `LeaveRequest(employeeId, status, startDate)` esiste; se sì OK, se no aggiungi solo se mancante).
- ❌ Refactor payroll-import-service per usare pura direttamente.
- ❌ Refactor altre route che chiamano `computeLeaveBalance` (employees, etc).
- ❌ Permanent dashboard timing log (decisione plan-phase).

## 7. File summary

**Nuovi:**
- `src/lib/leaves/balance.test.ts`

**Modificati:**
- `src/lib/leaves/balance.ts` — aggiunge `computeLeaveBalanceFromData`, refactor wrapper `computeLeaveBalance` per delegare. Export entrambi.
- `src/app/api/stats/dashboard/route.ts` — batch query in section E (leave balances) + range query in `computeOreChart`.

## 8. Effort & rischio

- Stima: ~1 giorno (8h).
- DB schema: nessuno.
- Prisma migration: nessuna.
- Breaking change API: zero (payload `/api/stats/dashboard` identico).
- Breaking change consumer interno: zero (`computeLeaveBalance` wrapper preserva signature).
- Deploy: standard pipeline esistente.
- Rischio principale: equivalenza output. Mitigato da 8 regression test su pure function + manual diff pre-merge.

## 9. Open points (post-implementation)

- Cache HTTP dashboard response (stale-while-revalidate?) → H10 RSC phase.
- Refactor payroll-import-service per N+1 simile → M-series follow-up.
- Verifica indice DB `LeaveRequest(employeeId, status, startDate)` esistente → check in plan, eventualmente aggiungi via M11.
