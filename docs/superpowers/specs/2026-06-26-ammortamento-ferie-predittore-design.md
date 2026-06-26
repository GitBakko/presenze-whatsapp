# Predittore di Ammortamento Ferie — Design Spec

**Data:** 2026-06-26
**Branch:** `feat/ammortamento-ferie`
**Stato:** approvato (brainstorming completato, 3 round di decisioni)

## 1. Obiettivo

Un **predittore di ammortamento ferie** che distribuisce automaticamente il residuo ferie/permessi
di ogni dipendente sui giorni lavorativi futuri, in modo da **azzerare il residuo entro il 31
dicembre** dell'anno corrente, evitando per quanto possibile che più dipendenti siano in ferie lo
stesso giorno. Il piano viene **ricalcolato a ogni upload del monte ferie certificato** (import
tabulato paghe), così da basarsi sempre su dati reali.

In parallelo, una **modifica collaterale** destruttura l'utilizzo ferie/permessi in tutte le
visualizzazioni, distinguendo ciò che è realmente goduto (passato) da ciò che è solo richiesto e
confermato per il futuro.

## 2. Decisioni di design (locked)

| # | Tema | Decisione |
|---|------|-----------|
| D1 | Orizzonte/obiettivo | Azzerare il residuo unificato (ferie+ROL) **entro 31 dic** anno corrente |
| D2 | Strategia distribuzione | Uniforme sui giorni lavorativi rimanenti + **anti-collisione soft** |
| D3 | Currency del pool | **Monte ore unico** = `vacationRemaining×dailyH + rolRemaining` → giornate intere; resto ROL indivisibile = scarto accettabile |
| D4 | Ordine build | **Grafici prima** (split passato/futuro), poi predittore |
| D5 | Modello dati | `LeaveRequest.source="PREDICTOR"`, `status="APPROVED"`, + `confirmedAt`/`confirmedById` (null = da confermare) |
| D6 | UI conferma | Pagina dedicata **"Piano ammortamento"** |
| D7 | Grafici | **4 bucket**: Monte · Goduti(passato) · Umani futuri · Predittore futuri |
| D8 | Anti-collisione | **Soft**, best-effort, company-wide, azzeramento prioritario; evita giorni con ferie umane approvate; sfora il minimo solo se necessario |
| D9 | Trigger ricalcolo | Confirm dell'**import tabulato paghe** (payroll-import PDF) |
| D10 | Comportamento ricalcolo | Mantiene passato + futuri-**confermati**; cancella+rigenera SOLO i predittore-futuri **non confermati** |

### Default derivati (non oggetto di domanda, stabiliti in design)

- **Toggle per-dipendente**: nuova colonna `Employee.leavePredictorEnabled Boolean @default(false)` (opt-in; i dipendenti esistenti partono OFF).
- **dailyH** (ore/giorno per conversione pool): `CONTRACT_DAILY_HOURS[contractType]` → FULL_TIME=8, PART_TIME=4 (riuso `schedule-fallback.ts`).
- **Tipi toccati dal predittore**: solo `VACATION` e `ROL`. Mai `SICK`/`BEREAVEMENT`/`MARRIAGE`/`LAW_104`/`MEDICAL_VISIT`.
- **Nessun nuovo background worker**: il ricalcolo è event-driven sull'upload + endpoint manuale "Ricalcola".

## 3. Insight di modellazione del saldo

`vacationRemaining` **deve** sottrarre anche gli impegni futuri (ferie approvate non ancora godute),
perché sono budget già impegnato. Quindi `vacationUsed` resta = passato + futuro ed è corretto per il
calcolo del residuo. **Il bug è solo nei grafici** che etichettano `vacationUsed` come "goduti".

Soluzione: aggiungere campi di breakdown senza cambiare la semantica di `vacationRemaining`.

```
vacationUsed = vacationUsedPast + vacationFutureHuman + vacationFuturePredictor   (invariante)
rolUsed      = rolUsedPast      + rolFutureHuman      + rolFuturePredictor          (invariante)
```

- `*UsedPast` — leave con `endDate ≤ today` (realmente goduto)
- `*FutureHuman` — leave con `startDate > today` e `source ≠ PREDICTOR`
- `*FuturePredictor` — leave con `startDate > today` e `source = PREDICTOR`

`now` è già iniettabile in `computeLeaveBalanceFromData()` (i test lo passano), quindi lo split è
deterministico e testabile.

## 4. Fasi di implementazione

### FASE 1 — Destrutturazione saldo + grafici 4-bucket (nessun cambio schema)

**Backend**
- `src/lib/leaves/balance.ts`: nel loop di tally (righe ~226–253) calcolare i 6 nuovi sotto-totali
  in base a `endDate ≤ now` (passato) vs `startDate > now` (futuro) e `source`. Estendere
  `LeaveBalanceSummary` (righe ~91–112) con i 6 campi. Per i leave che attraversano `today`
  (iniziati nel passato, finiscono nel futuro) la quota goduta si conta sui giorni ≤ today.
- `src/types/dashboard.ts`: estendere `LeaveBalanceRow` con `vacationUsedPast`, `vacationFutureHuman`,
  `vacationFuturePredictor` (ROL idem se mostrato).
- `src/app/api/stats/dashboard/route.ts` (sez. E): popolare i nuovi campi da
  `computeLeaveBalanceFromData`.

**Frontend (mostrano i 4 bucket con legenda/colori coerenti)**
- `src/components/dashboard/LeaveBalanceTable.tsx`
- `src/app/(dashboard)/leaves/_components/BalanceCard.tsx`
- `src/app/(dashboard)/leaves/_components/ByEmployeeView.tsx`
- `src/app/(dashboard)/employees/[id]/page.tsx`
- `AssenzeChart` già filtra per periodo: nessuna modifica funzionale (verificare).

**Colori bucket** (proposta, coerente col design system): Monte = neutro/teal · Goduti = blu pieno ·
Umani futuri = blu tenue/tratteggiato · Predittore futuri = ambra/viola con icona dedicata.

**Test**: invariante `used = past + futureHuman + futurePredictor`; leave a cavallo di today; leave
tutto-passato e tutto-futuro.

### FASE 2 — Modello dati predittore (`db:push` + `db:generate`, NO migrate)

```prisma
model Employee {
  // ... campi esistenti
  leavePredictorEnabled Boolean @default(false)
}

model LeaveRequest {
  // ... campi esistenti
  source        String    @default("MANAGER")  // MANAGER | EXTERNAL_API | PREDICTOR
  confirmedAt   DateTime?                       // null = predittore in attesa di conferma HR
  confirmedById String?                         // User.id che ha confermato
}

model LeavePredictorRun {
  id            String   @id @default(cuid())
  triggeredById String?                          // null = automatico da import
  trigger       String                           // "PAYROLL_IMPORT" | "MANUAL"
  runAt         DateTime @default(now())
  year          Int
  payload       String                           // JSON per-dipendente: { generated, vacDays, rolDays, scrapHours, collisions }
}
```

Note: `source` è già `String` → nessuna migrazione di enum. `confirmedAt` distingue
predittore-da-confermare (null) da predittore-confermato (valorizzato). I leave umani non usano
questi campi.

### FASE 3 — Motore di ammortamento (funzione pura + service)

**Modulo nuovo** `src/lib/leaves/amortization.ts` (o sottocartella `predictor/`).

**Funzione pura** — nessun accesso DB, massima testabilità:
```ts
planAmortization(
  employees: EmployeeAmortInput[],   // residui, schedule/contract, hireDate, terminationDate
  now: Date,
  yearEnd: string,                   // "YYYY-12-31"
): Map<employeeId, PlannedDay[]>     // PlannedDay = { date, type: "VACATION"|"ROL", hours? }
```

Algoritmo:
1. **Pool per dipendente**:
   - `dailyH = CONTRACT_DAILY_HOURS[contractType]`
   - `vacWholeDays = floor(vacationRemaining)`
   - `fracHours = (vacationRemaining − vacWholeDays) × dailyH`
   - `rolPool = rolRemaining + fracHours`
   - `rolWholeDays = floor(rolPool / dailyH)`
   - `scrapHours = rolPool − rolWholeDays × dailyH`  *(scarto accettabile)*
   - `totalDays = vacWholeDays + rolWholeDays`
2. **Giorni candidati** per dipendente: `[today+1 .. 31 dic]` ∩ giorni lavorativi (schedule reale o
   fallback Mon-Fri) − festivi (`isPublicHoliday`) − giorni già occupati da suoi leave esistenti −
   giorni `≥ terminationDate`.
3. **Assegnazione anti-collisione**: un contatore di occupancy company-wide **seminato con le ferie
   umane future già approvate**. Ogni dipendente prende i giorni a occupancy minima (prima quelli a 0,
   poi 1, …). Soft: se per raggiungere `totalDays` non bastano i giorni liberi, si sfora il minimo.
4. **Output**: `vacWholeDays` × `{type:VACATION}` + `rolWholeDays` × `{type:ROL, hours:dailyH}`
   (giornata piena finanziata dai permessi).

**Service** `recomputeAmortization(year, trigger, actorUserId?, tx?)`:
1. Wipe dei leave `source=PREDICTOR ∧ confirmedAt=null ∧ startDate > today` (i confermati e i passati
   restano).
2. Ricarica i residui (ora al netto di goduti + predittore-confermati → soddisfa la formula della
   regola 2: `disponibile = certificato − goduti − predittore_impostato`).
3. Chiama `planAmortization`.
4. Crea i `LeaveRequest` (`source=PREDICTOR`, `status=APPROVED`, `confirmedAt=null`).
5. Scrive un record `LeavePredictorRun` (audit/observability).
6. Pubblica notifica su `notificationsBus`.

### FASE 4 — Trigger ricalcolo

- Hook in `src/lib/payroll-import-service.ts` → `confirmImport()`: dopo l'upsert dei `LeaveBalance`,
  chiamare `recomputeAmortization(year, "PAYROLL_IMPORT")` per i dipendenti con
  `leavePredictorEnabled=true`.
- Endpoint manuale `POST /api/leaves/predictor/recompute` (admin, `checkAuth`) per il bottone
  "Ricalcola" della pagina Piano ammortamento.
- Notifica `notificationsBus.publish({ action: <esistente>, details: { recordType: "LEAVE_AMORTIZATION" } })`.

### FASE 5 — UI

- **Pagina "Piano ammortamento"** (`src/app/(dashboard)/leaves/amortization/` o voce dedicata):
  - Per dipendente: residuo (monte ore unico) vs pianificato vs scarto; lista/timeline dei giorni
    predittore; **conferma/cancella singolo o in blocco**; stato (da confermare / confermato).
  - Bottone **"Ricalcola"** globale.
  - Toggle on/off predittore per dipendente.
  - Indicatore collisioni (giorni con ≥2 dipendenti).
- **Badge "Predittore"** distinto (colore + icona) in: `CalendarView`, `RequestsList` (colonna Fonte →
  +"Predittore"), `GanttCalendar`, `ByEmployeeView`. Azioni conferma/cancella inline coerenti con la
  pagina dedicata.
- **Toggle** anche nel form `src/app/(dashboard)/employees/[id]/edit/page.tsx` (+ handler PUT
  `src/app/api/employees/[id]/route.ts`).
- **API**: `GET /api/leaves/predictor/plan?year=` (piano corrente per dipendente),
  `POST /api/leaves/[id]/confirm` (conferma un giorno predittore → set `confirmedAt`/`confirmedById`),
  cancellazione via DELETE `/api/leaves/[id]` esistente.

### FASE 6 — Validazione

- `npm run build && npm test` verde (obbligatorio prima del commit).
- **impeccable**: `audit` sui nuovi moduli frontend (Piano ammortamento, badge, grafici 4-bucket) +
  `polish`/`critique` + check coerenza piattaforma.
- **Smoke + E2E** via plugin Chrome (claude-in-chrome): login → upload tabulato paghe → verifica
  ricalcolo piano → conferma/cancella giorni → verifica grafici 4-bucket → toggle predittore on/off.
  GIF di evidenza dei flussi chiave.

## 5. Strategia di test

- **`planAmortization` (pura)**, pattern `balance.test.ts` con `now` iniettato:
  - azzeramento entro fine anno
  - anti-collisione (2 dipendenti non si sovrappongono quando c'è spazio; sforo minimo quando non c'è)
  - scarto ROL indivisibile
  - part-time (dailyH=4)
  - termination (nessun giorno dopo `terminationDate`)
  - fallback no-schedule (Mon-Fri)
  - frazione ferie riversata nel pool ROL
  - evita giorni con ferie umane future
- **balance split**: invariante `used = past + futureHuman + futurePredictor`; leave a cavallo di today.
- **recompute service**: mock prisma (pattern `edit-service.test.ts`); verifica che il wipe colpisca
  SOLO `source=PREDICTOR ∧ confirmedAt=null ∧ startDate>today`.

## 6. Gotchas rispettate

- Schema: `npm run db:push` + `npm run db:generate`, **mai** `prisma migrate` (no `migrations/`).
- Date come stringhe `"YYYY-MM-DD"` / `"HH:MM"`; usare `tz.ts`/`date-utils.ts`, niente `new Date()`
  sulla logica di calendario (eccetto `now` iniettato per i confronti, come già fa balance.ts).
- Eventuale stato in-process condiviso → ancorato su `globalThis` (ma qui il ricalcolo è
  event-driven, nessun singleton nuovo previsto).
- Import idempotente già garantito da `@@unique` su `AttendanceRecord`; i `LeaveRequest` predittore
  vengono ricreati ad ogni ricalcolo (wipe+regenerate dei non confermati).
- `source` è `String` → nessuna migrazione di enum per il valore `PREDICTOR`.

## 7. Out of scope

- Notifiche ai dipendenti dei giorni pianificati (solo HR per ora).
- Ottimizzazione "preferisci ponti" o "settimane intere" (scelta: distribuzione uniforme).
- Predittore su tipi diversi da VACATION/ROL.
- Background worker schedulato (il trigger è l'upload).
