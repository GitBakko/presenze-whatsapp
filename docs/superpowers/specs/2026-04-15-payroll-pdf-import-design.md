# Payroll PDF Import — Design Spec

**Date:** 2026-04-15
**Author:** Stefano Brunelli (brainstormed with Claude)
**Status:** Draft — awaiting review
**Scope:** Import of payroll-system PDF report ("Tabulato situazione ferie, festività, permessi, banca ore") into the HR app's `LeaveBalance`, so that the balances shown in-app match the authoritative values produced by the payroll consultant each month.

---

## 1. Goal & success criteria

**Goal:** Replace the current manual process of editing `vacationCarryOver` / `rolCarryOver` / `*AccrualAdjust` on each `Employee` edit form with an automated PDF-based import. A single upload reconciles all employees at once.

**Success criteria:**
1. After import, for every matched employee, the `remaining` value displayed in the app (both ferie in days and ROL in hours) equals the `RESIDUO` column of the PDF, down to two decimals.
2. Re-importing the same PDF is idempotent (produces the same DB state).
3. Importing a newer PDF for the same year correctly updates the balances, even if `LeaveRequest` rows have been added between imports.
4. Every import is auditable — we can reconstruct pre/post state for every touched employee from the `PayrollImport` history.
5. Admin can associate unmatched PDF rows to existing employees inline, without leaving the import page.

**Non-goals (YAGNI):**
- Multi-company / multi-tenant handling (Ditta EPARTE hardcoded in PDF, single company).
- Scheduled/automatic imports (manual UI only).
- Writing back to the payroll system.
- Banca Ore support (row present in PDF but always 0; no app field for it).
- Per-month breakdown in app (app only tracks yearly totals).
- Bulk-reset tools, undo, or rollback beyond the audit log.

---

## 2. Data model changes

All via `npm run db:push` (project convention — no migration files).

### 2.1 `Employee.payrollId`

```prisma
model Employee {
  // ... existing fields ...
  payrollId String? @unique   // matricola from payroll system (nullable; populated over time)
}
```

- Nullable so existing employees don't break.
- `@unique` prevents two employees pointing to the same payroll row.
- Populated either (a) from the employee edit form (new input field) or (b) from the inline "associa a dipendente" action on the import preview.

### 2.2 New `PayrollImport` model

```prisma
model PayrollImport {
  id                String   @id @default(cuid())
  createdAt         DateTime @default(now())
  userId            String                   // admin who confirmed the import
  fileName          String                   // original filename
  fileHash          String                   // SHA-256 of PDF bytes, for de-dup detection
  year              Int                      // year parsed from PDF header
  sourceMonth       String                   // "Marzo 2026" verbatim from PDF header
  totalEmployees    Int                      // rows in PDF
  matchedEmployees  Int                      // rows with payrollId match
  skippedEmployees  Int                      // rows unmatched at confirm time (should be 0 in normal flow)
  orphanEmployees   Int                      // app employees not found in PDF
  payload           Json                     // snapshot: see §2.3

  user     User    @relation(fields: [userId], references: [id])

  @@index([year])
  @@index([fileHash])
  @@index([createdAt])
}
```

### 2.3 `PayrollImport.payload` JSON shape

```jsonc
{
  "rows": [
    {
      "matricola": "5",
      "cognomePdf": "BRUNELLI",
      "nomePdf": "STEFANO",
      "employeeId": "clx123...",
      "before": {
        "vacationCarryOver": 22.00,
        "vacationAccrualAdjust": 1.00,
        "rolCarryOver": 15.00,
        "rolAccrualAdjust": 0.00
      },
      "after": {
        "vacationCarryOver": 24.65,
        "vacationAccrualAdjust": 3.15,
        "rolCarryOver": 7.01,
        "rolAccrualAdjust": 0.00
      },
      "pdfValues": {
        "fer": { "resAP": 24.65, "maturato": 5.50, "goduto": 0.00, "residuo": 30.15 },
        "fes": { "resAP": 0.00,  "maturato": 8.00, "goduto": 0.00, "residuo": 8.00 },
        "per": { "resAP": 7.01,  "maturato": 14.00, "goduto": 0.00, "residuo": 21.01 }
      },
      "appValuesAtImport": {
        "vacationAccrued": 3.85,
        "vacationUsed": 0.00,
        "rolAccrued": 17.50,
        "rolUsed": 0.00
      },
      "warnings": []
    }
  ],
  "orphans": [
    { "employeeId": "clx999...", "name": "Mario Rossi" }
  ]
}
```

### 2.4 No changes to `LeaveBalance`

Existing schema is sufficient. Only `vacationCarryOver`, `vacationAccrualAdjust`, `rolCarryOver`, `rolAccrualAdjust` are written by the import.

---

## 3. PDF parser — `src/lib/payroll-pdf-parser.ts`

**Dependency:** `pdf-parse` (new). To be added to `package.json`. Fallback plan if incompatible with this specific PDF layout: swap for `pdfjs-dist` during implementation (interface of parser stays the same).

**Public API:**

```ts
export interface PayrollPdfRow {
  matricola: string;
  cognome: string;
  nome: string;
  fer: PayrollCategoryValues;  // in days
  fes: PayrollCategoryValues;  // in hours
  per: PayrollCategoryValues;  // in hours
  // B.O deliberately ignored
}

export interface PayrollCategoryValues {
  resAP: number;      // "Res. A.P." — carry from previous year (may be negative)
  maturato: number;   // "MATURATO ACCANT."
  goduto: number;     // "GODUTO"
  residuo: number;    // "RESIDUO" — should equal resAP + maturato - goduto (validation warning if mismatch > 0.01)
}

export interface PayrollPdfParseResult {
  year: number;            // parsed from header "al mese di <Month> <YYYY>"
  month: number;           // 1..12
  sourceMonthLabel: string;// "Marzo 2026"
  ditta: string;           // "EPARTE" (currently hardcoded checked against "EPARTE")
  rows: PayrollPdfRow[];
}

export class PayrollParseError extends Error { /* kind + hint */ }

export async function parsePayrollPdf(buffer: Buffer): Promise<PayrollPdfParseResult>;
```

**Algorithm (outline):**
1. Extract raw text via `pdf-parse`.
2. Detect header: regex for `al mese di\s+(\w+)\s+(\d{4})`. Italian month name → month number.
3. Detect `Ditta\s+EPARTE` — else `PayrollParseError('unsupported-company')`.
4. Split into employee blocks: each block starts with a line matching `^\s*!\s*\d+\s*!` (matricola line). Block ends at next such line OR at the summary "TOTALI" section.
5. Within each block, for each of the 4 category codes (FER/FES/PER/B.O), parse the 16 numeric columns (12 months + `Res.A.P.` + `MATURATO` + `GODUTO` + `RESIDUO`).
   - Numbers use Italian format: comma decimal, trailing `-` for negatives (e.g. `0,19-` → `-0.19`). Empty cell → `0`.
6. Skip the B.O row. Skip the final TOTALI block.
7. Validate: `abs(resAP + maturato - goduto - residuo) < 0.01` for each category → otherwise attach warning to row (not fatal).
8. Return structured result.

**Tests (`payroll-pdf-parser.test.ts`):**
- Fixture: commit the attached tabulato as `prisma/fixtures/tabulato-marzo-2026.pdf`.
- Parses 9 employee rows.
- Specific numeric assertions for Brunelli, Seppolini, Costieri (negative value), Cojocaru (sparse values), Mengana (part-time, lower maturato).
- `year=2026, month=3`.
- B.O rows not emitted.
- Corrupted PDF → throws `PayrollParseError`.
- PDF with different company name → throws.

---

## 4. API routes

Both under `src/app/api/settings/payroll-import/`. Gated by `checkAuth()` with admin-role check (reusing current admin-gate pattern from other settings routes).

### 4.1 `POST /api/settings/payroll-import/preview`

**Request:** `multipart/form-data` with a single `file` field (PDF, max 5MB).

**Response:** `application/json`

```ts
{
  year: number;
  sourceMonthLabel: string;
  fileHash: string;
  alreadyImported: { importId: string; createdAt: string } | null;
  rows: PreviewRow[];
  orphans: { employeeId: string; displayName: string }[];
}

interface PreviewRow {
  matricola: string;
  cognomePdf: string;
  nomePdf: string;
  matched: boolean;
  employeeId: string | null;
  employeeDisplayName: string | null;
  vacation: DiffPair;  // days
  rol: DiffPair;       // hours (fes+per combined)
  warnings: string[];
}

interface DiffPair {
  currentRemaining: number;
  newRemaining: number;
  currentCarryOver: number;
  newCarryOver: number;
  currentAdjust: number;
  newAdjust: number;
}
```

**Behavior:**
1. Auth check.
2. Parse PDF (rejects with 422 if `PayrollParseError`).
3. Compute `fileHash = sha256(buffer)`.
4. Look up existing `PayrollImport` with same hash → `alreadyImported`.
5. For each PDF row: try `Employee.findUnique({ where: { payrollId: matricola } })`. Build diff by reading current `LeaveBalance` for `(employeeId, year)` and running `computeLeaveBalance` (from `src/lib/leaves.ts`) to get `vacationAccrued/Used` and `rolAccrued/Used` at import-time, then applying the mapping formula (§5).
6. Compute orphan list: `Employee.findMany({ payrollId: { not: null } })` minus matched IDs, plus all employees with null `payrollId` that have a `LeaveBalance` row for that year.
7. No DB writes.

**Errors:** 400 (bad request), 401 (auth), 403 (not admin), 413 (too large), 415 (not PDF), 422 (parse error).

### 4.2 `POST /api/settings/payroll-import/confirm`

**Request:** `multipart/form-data` with `file` field (same PDF) + `confirmHash` field (must equal previously seen `fileHash`). We re-parse server-side; the client is not the source of truth.

**Response:**
```ts
{ importId: string; matched: number; skipped: number; orphans: number }
```

**Behavior:**
1. Auth + admin.
2. Parse PDF, recompute `fileHash`, verify matches `confirmHash`.
3. For each PDF row, look up `Employee` by `payrollId`.
4. **Fail with 400** if any PDF row lacks a match (UI prevents this, but server re-validates).
5. Open Prisma transaction:
   - For each matched employee: compute `appValuesAtImport` via `computeLeaveBalance`; compute `after` values via mapping formula; `upsert` `LeaveBalance` for `(employeeId, year)`; record `before/after/pdfValues/appValuesAtImport` in the payload array.
   - Insert one `PayrollImport` row with aggregated payload.
6. Commit, return summary.

**Idempotency:** unchanged from §5 — the formula produces the same result when re-run, because `accrualAdjust` is recomputed against current `accrued_app` / `used_app`.

### 4.3 `GET /api/settings/payroll-import/history`

Lists `PayrollImport` rows (paged, most recent first) with summary stats.

### 4.4 `GET /api/settings/payroll-import/history/:id`

Returns full `payload` for audit view.

### 4.5 `PATCH /api/employees/:id`

**No new route** — the existing employee-edit endpoint already accepts arbitrary `Employee` fields. Just add `payrollId` to the allowed fields and form schema. The inline "associa a dipendente" on the preview page calls this existing route.

---

## 5. Mapping formula

For each matched employee and each category (vacation in days, ROL in hours):

Given, from PDF:
- `pdf.fer.resAP` (days, may be negative)
- `pdf.fer.residuo` (days)

ROL fusion (sum of FES and PER):
- `pdf.rol.resAP = pdf.fes.resAP + pdf.per.resAP`
- `pdf.rol.residuo = pdf.fes.residuo + pdf.per.residuo`

Given, from app runtime (via `computeLeaveBalance(employeeId, year)`):
- `app.vacationAccrued`, `app.vacationUsed`
- `app.rolAccrued`, `app.rolUsed`

Write to `LeaveBalance`:

```
vacationCarryOver     = pdf.fer.resAP
vacationAccrualAdjust = pdf.fer.residuo − (pdf.fer.resAP + app.vacationAccrued − app.vacationUsed)
rolCarryOver          = pdf.rol.resAP
rolAccrualAdjust      = pdf.rol.residuo − (pdf.rol.resAP + app.rolAccrued − app.rolUsed)
```

Leave untouched (runtime-computed anyway, DB values ignored):
- `vacationAccrued`, `vacationUsed`, `rolAccrued`, `rolUsed`, `sickDays`.

**Invariant after upsert:** `remaining_app = pdf.residuo` exactly (± floating-point rounding to 2 decimals, handled by existing `Math.round(x * 100) / 100` in `computeLeaveBalance`).

**Why this works on re-import:** if between imports the user approves a new `LeaveRequest`, `app.used` grows. Re-importing the same PDF recomputes `accrualAdjust` with the new `app.used`, and the app's `remaining` still equals `pdf.residuo`. The audit log shows the adjustment delta so the admin can see what changed.

**Unit handling:**
- FER values are days, written as-is to `vacation*` fields (already in days).
- FES+PER values are hours, written as-is to `rol*` fields (already in hours).
- No unit conversion needed.

---

## 6. UI

### 6.1 Settings hub card

`src/app/(dashboard)/settings/page.tsx` — add a card:

> **Import tabulato paghe**
> Importa ferie, festività e permessi dal PDF del consulente paghe.

Links to `/settings/payroll-import`.

### 6.2 `/settings/payroll-import` (main page)

Three logical steps on one page, driven by local state (no routing).

**Step 1 — Upload**
- Drag-and-drop zone + file picker (PDF only, 5MB max).
- On file selected → POST to `/preview` → show loading spinner.
- On parse error (422) → error banner with hint from server.

**Step 2 — Preview**
- Header: "Tabulato **Marzo 2026** — 9 dipendenti nel PDF · 7 associati · 2 da associare".
- If `alreadyImported` → yellow banner "Questo file è già stato importato il GG/MM/AAAA · [vai allo storico]". Confirm button enabled but with secondary confirmation dialog.
- Orphan banner (if any): "I seguenti dipendenti dell'app non sono nel PDF: X, Y. I loro saldi NON verranno modificati." (no action required, informational).
- Table:
  | Matricola | PDF (Cognome Nome) | Dipendente app | Ferie (giorni) | ROL (ore) | Warning |
  |---|---|---|---|---|---|
  | 5 | BRUNELLI STEFANO | Stefano Brunelli | 28,50 → **30,15** | 22,00 → **29,01** | — |
  | 99 | NEWBIE MARCO | <rosso: Associa a…> | — | — | Matricola non associata |
- Rows with `matched=false` show an inline `<select>` listing employees with `payrollId = null`. On change → PATCH `/api/employees/:id { payrollId }` → refresh preview.
- Delta cells use green/red styling based on direction.
- Warnings cell lists any from parser (e.g. "Residuo ferie negativo nel PDF", "MATURATO non quadra con RESIDUO per 0,05").

**Step 3 — Confirm**
- "Conferma import" button: disabled if any unmatched rows.
- On click → confirm dialog "Questa operazione aggiornerà 7 saldi ferie/ROL. Procedere?"
- On confirm → POST `/confirm` with file blob + hash → toast success → redirect to `/settings/payroll-import/history/:id`.

### 6.3 `/settings/payroll-import/history`

List view:
| Data | Utente | File | Anno | Mese | Matchati | Skippati | Orfani | Dettagli |

Each row links to detail page showing per-employee diff (before/after/pdf values).

### 6.4 Employee edit form

Existing form at `src/app/(dashboard)/employees/:id/edit` (or equivalent): add a section **"Paghe"** with a single input `payrollId` (text, optional). P2002 on save → user-friendly error "Matricola già in uso da <employee name>".

### 6.5 Sidebar

No new sidebar entry (it's a settings subpage, reached via Settings hub, consistent with `api-keys`, `nfc`, etc.).

---

## 7. Security & permissions

- Both API routes: `checkAuth()` + role check `session.user.role === 'ADMIN'`. Manager role NOT allowed.
- File processed in-memory only, not persisted to disk.
- `fileHash` used for dedup/audit, not security.
- Payload stored in `PayrollImport` contains only numeric snapshots and matricole/names — no raw PDF.
- Rate limiting: rely on existing middleware if present; otherwise deferred (not blocking).

---

## 8. Error handling matrix

| Condition | HTTP | Message / Behavior |
|---|---|---|
| Not authenticated | 401 | Standard redirect to login |
| Not admin | 403 | "Operazione riservata agli amministratori" |
| File > 5MB | 413 | "File troppo grande (max 5MB)" |
| MIME ≠ application/pdf | 415 | "Il file deve essere un PDF" |
| PDF parse failure | 422 | "Formato PDF non riconosciuto" + hint |
| Header year/month unreadable | 422 | "Impossibile determinare l'anno di riferimento" |
| Company ≠ EPARTE | 422 | "PDF di azienda non supportata: <name>" |
| Duplicate matricola in PDF | 422 | "Matricole duplicate nel PDF: 5, 7" |
| Confirm with unmatched rows | 400 | `{ error, unmatchedMatricole: [...] }` — UI prevents this |
| Confirm hash mismatch | 400 | "Il file è cambiato, ricarica la preview" |
| P2002 on `payrollId` (employee edit) | 409 | "Matricola già in uso da <name>" |
| Transaction failure mid-import | 500 | Rollback, nothing written, user retries |
| Negative `resAP` in PDF | — | Accepted, warning shown, imported as-is |

---

## 9. Testing strategy

**Unit tests** (vitest, existing runner):

1. `payroll-pdf-parser.test.ts` — see §3.
2. `payroll-import-logic.test.ts`:
   - Mapping formula: given `(pdf, app)` inputs, produces correct `(carryOver, adjust)`.
   - ROL fusion: `pdf.fes + pdf.per` summed correctly.
   - Idempotence: running mapping twice produces same `LeaveBalance`.
   - Negative `resAP` preserved.
3. No DB integration test — project lacks test DB setup.

**Manual verification checklist** (documented in spec, run by Stefano post-implementation):

- [ ] Upload the attached March 2026 PDF → preview shows all 9 employees.
- [ ] Associate matricole for at least 2 unmatched employees inline.
- [ ] Confirm import.
- [ ] Dashboard: Brunelli's `Ferie residue = 30,15 giorni`, `ROL residue = 29,01 ore` (= 8,00 + 21,01).
- [ ] Costieri's `Ferie residue = 2,31` (negative `resAP` handled).
- [ ] Re-upload same PDF → preview shows "già importato" banner, proceed → no changes (idempotent).
- [ ] Approve a new 1-day `LeaveRequest` for Brunelli → dashboard shows `29,15 giorni`.
- [ ] Re-import PDF → Brunelli back to `30,15` (accrualAdjust recomputed to compensate).
- [ ] Audit page shows both imports with correct before/after.

---

## 10. Dependencies & migration order

**Build order** (suggested for writing-plans):

1. Schema change (`Employee.payrollId`, `PayrollImport` model) + `db:push`.
2. `payroll-pdf-parser.ts` + tests (with fixture PDF committed).
3. Mapping logic module + tests.
4. API routes (`preview`, `confirm`, history read).
5. Employee edit form: add `payrollId` field.
6. UI: `/settings/payroll-import` page.
7. UI: `/settings/payroll-import/history` pages.
8. Settings hub card.
9. Manual verification.

**New npm dependency:** `pdf-parse`.

---

## 11. Open risks

- **Parser fragility:** the PDF uses fixed-width ASCII with `!` and `+` separators. Small formatting changes from the payroll provider (column widths, separator characters) could break parsing. Mitigation: validation at multiple levels (header, block count, residuo arithmetic check); fixture-based regression tests; clear 422 error pointing to likely cause. If breakage happens, add new fixture + fix, ship patch.
- **`computeLeaveBalance` cost:** called once per employee during preview and again at confirm. For ~30 employees it's fine, but it reads `LeaveRequest` per employee. If slow, batch-fetch requests first and pass them in.
- **Single-company hardcode:** if EPARTE ever renames or a second company is added, we need to loosen the `Ditta EPARTE` check. Not blocking now.
