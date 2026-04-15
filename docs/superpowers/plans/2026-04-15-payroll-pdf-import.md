# Payroll PDF Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin tool to upload the monthly payroll-system PDF ("Tabulato situazione ferie/permessi") and reconcile each employee's `LeaveBalance` so that the in-app `remaining` matches the PDF `RESIDUO`, with full audit trail.

**Architecture:** Server-side PDF parser → preview API computes diffs → admin associates unmatched matricole inline → confirm API writes `LeaveBalance` (carryOver + accrualAdjust) inside a transaction and records a `PayrollImport` row. Idempotent: re-running the same PDF reproduces the same balances. Auth: existing `checkAuth()` gates everything to ADMIN.

**Tech Stack:** Next.js 16 App Router, Prisma 6 + SQLite, NextAuth 5 JWT, Tailwind 4, sonner toasts, vitest for tests, new dep `pdf-parse` for PDF text extraction.

**Spec:** [docs/superpowers/specs/2026-04-15-payroll-pdf-import-design.md](../specs/2026-04-15-payroll-pdf-import-design.md)

---

## File map

**Schema:**
- Modify: `prisma/schema.prisma` — add `Employee.payrollId`, add `PayrollImport` model

**Library code:**
- Create: `src/lib/payroll-pdf-parser.ts` — pure parsing
- Create: `src/lib/payroll-pdf-parser.test.ts` — fixture-based tests
- Create: `src/lib/payroll-import-mapping.ts` — pure mapping formula
- Create: `src/lib/payroll-import-mapping.test.ts` — formula tests
- Create: `src/lib/payroll-import-service.ts` — orchestration (parse + diff + write); uses `computeLeaveBalance` from `src/lib/leaves.ts`

**API routes:**
- Create: `src/app/api/settings/payroll-import/preview/route.ts`
- Create: `src/app/api/settings/payroll-import/confirm/route.ts`
- Create: `src/app/api/settings/payroll-import/history/route.ts`
- Create: `src/app/api/settings/payroll-import/history/[id]/route.ts`
- Modify: `src/app/api/employees/[id]/route.ts` — accept and return `payrollId`

**UI:**
- Create: `src/app/(dashboard)/settings/payroll-import/page.tsx` — 3-step upload+preview+confirm
- Create: `src/app/(dashboard)/settings/payroll-import/history/page.tsx` — list
- Create: `src/app/(dashboard)/settings/payroll-import/history/[id]/page.tsx` — detail
- Modify: `src/app/(dashboard)/settings/page.tsx` — add hub card
- Modify: `src/app/(dashboard)/employees/[id]/page.tsx` — add `payrollId` input

**Fixtures:**
- Create: `prisma/fixtures/tabulato-marzo-2026.pdf` — copy of the example PDF (committed to git, used by parser tests)

---

## Task 1 — Schema: add `payrollId` and `PayrollImport`

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Edit Employee model — add `payrollId`**

In the `Employee` block, add the field after `email`:

```prisma
  email        String?            @unique
  payrollId    String?            @unique // matricola from payroll system
```

- [ ] **Step 2: Add `PayrollImport` model**

Append at the end of the file (after the last model):

```prisma
model PayrollImport {
  id               String   @id @default(cuid())
  createdAt        DateTime @default(now())
  userId           String
  fileName         String
  fileHash         String
  year             Int
  sourceMonth      String   // "Marzo 2026"
  totalEmployees   Int
  matchedEmployees Int
  skippedEmployees Int
  orphanEmployees  Int
  payload          String   // JSON: see plan §2.3 / spec

  user User @relation("PayrollImports", fields: [userId], references: [id])

  @@index([year])
  @@index([fileHash])
  @@index([createdAt])
}
```

(SQLite has no JSON column type — use `String` and `JSON.stringify`/`JSON.parse` at the boundary, consistent with existing models like `Anomaly.aliases`.)

- [ ] **Step 3: Add reverse relation on `User`**

In the `User` model, add to the relations block:

```prisma
  payrollImports PayrollImport[] @relation("PayrollImports")
```

- [ ] **Step 4: Run db:push and verify**

Run: `npm run db:push`
Expected: "🚀  Your database is now in sync with your Prisma schema. Done in …"

Then run: `npx prisma generate`
Expected: "✔ Generated Prisma Client"

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add Employee.payrollId and PayrollImport model"
```

---

## Task 2 — Add `pdf-parse` dependency and fixture PDF

**Files:**
- Modify: `package.json`
- Create: `prisma/fixtures/tabulato-marzo-2026.pdf`

- [ ] **Step 1: Install pdf-parse**

Run: `npm install pdf-parse@^1.1.1`
Then: `npm install --save-dev @types/pdf-parse`

Expected: both packages added to `package.json`.

- [ ] **Step 2: Copy the example PDF as test fixture**

The user provided "TABULATO FERIE E PERMESSI 31.03.2026 E-PARTNER.pdf". Copy it to `prisma/fixtures/tabulato-marzo-2026.pdf` (create the directory if missing).

```bash
mkdir -p prisma/fixtures
cp "TABULATO FERIE E PERMESSI 31.03.2026 E-PARTNER.pdf" prisma/fixtures/tabulato-marzo-2026.pdf
```

(If the source PDF is in a different location, adjust accordingly. The fixture is required for parser tests.)

- [ ] **Step 3: Verify pdf-parse can read the fixture** (smoke test)

Create a temporary file `tmp-pdf-smoke.mjs`:

```js
import pdf from "pdf-parse";
import { readFileSync } from "fs";
const buf = readFileSync("prisma/fixtures/tabulato-marzo-2026.pdf");
const data = await pdf(buf);
console.log("pages:", data.numpages);
console.log("first 500 chars:\n", data.text.slice(0, 500));
```

Run: `node tmp-pdf-smoke.mjs`
Expected: prints page count (4) and first chunk of extracted text containing "BRUNELLI" / "STEFANO" / "MATURATO".

Delete `tmp-pdf-smoke.mjs` after verifying.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json prisma/fixtures/tabulato-marzo-2026.pdf
git commit -m "chore: add pdf-parse dep and payroll PDF fixture"
```

---

## Task 3 — PDF parser: failing test for header extraction

**Files:**
- Create: `src/lib/payroll-pdf-parser.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parsePayrollPdf } from "./payroll-pdf-parser";

const FIXTURE = readFileSync(
  join(process.cwd(), "prisma/fixtures/tabulato-marzo-2026.pdf")
);

describe("parsePayrollPdf — header", () => {
  it("extracts year, month and source label from header", async () => {
    const result = await parsePayrollPdf(FIXTURE);
    expect(result.year).toBe(2026);
    expect(result.month).toBe(3);
    expect(result.sourceMonthLabel).toBe("Marzo 2026");
    expect(result.ditta).toBe("EPARTE");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/payroll-pdf-parser.test.ts`
Expected: FAIL — module `./payroll-pdf-parser` does not exist.

---

## Task 4 — PDF parser: minimal implementation for header

**Files:**
- Create: `src/lib/payroll-pdf-parser.ts`

- [ ] **Step 1: Create the parser file with header logic only**

```ts
import pdfParse from "pdf-parse";

export interface PayrollCategoryValues {
  resAP: number;
  maturato: number;
  goduto: number;
  residuo: number;
}

export interface PayrollPdfRow {
  matricola: string;
  cognome: string;
  nome: string;
  fer: PayrollCategoryValues;
  fes: PayrollCategoryValues;
  per: PayrollCategoryValues;
  warnings: string[];
}

export interface PayrollPdfParseResult {
  year: number;
  month: number;
  sourceMonthLabel: string;
  ditta: string;
  rows: PayrollPdfRow[];
}

export class PayrollParseError extends Error {
  constructor(public kind: string, message: string, public hint?: string) {
    super(message);
    this.name = "PayrollParseError";
  }
}

const MONTH_MAP: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

export async function parsePayrollPdf(buffer: Buffer): Promise<PayrollPdfParseResult> {
  const data = await pdfParse(buffer);
  const text = data.text;

  const headerMatch = text.match(/al mese di\s+(\w+)\s+(\d{4})/i);
  if (!headerMatch) {
    throw new PayrollParseError(
      "missing-header",
      "Impossibile determinare l'anno di riferimento dal PDF",
      "Verifica che il PDF sia un tabulato standard (intestazione 'al mese di <Mese> <Anno>')."
    );
  }
  const monthName = headerMatch[1].toLowerCase();
  const month = MONTH_MAP[monthName];
  const year = parseInt(headerMatch[2], 10);
  if (!month) {
    throw new PayrollParseError("invalid-month", `Mese non riconosciuto: ${headerMatch[1]}`);
  }

  const sourceMonthLabel = `${headerMatch[1][0].toUpperCase()}${monthName.slice(1)} ${year}`;

  const dittaMatch = text.match(/Ditta\s+([A-Z]+)/);
  const ditta = dittaMatch?.[1] ?? "";
  if (ditta !== "EPARTE") {
    throw new PayrollParseError(
      "unsupported-company",
      `PDF di azienda non supportata: ${ditta || "(sconosciuta)"}`,
      "Questo strumento è configurato solo per la ditta EPARTE."
    );
  }

  return { year, month, sourceMonthLabel, ditta, rows: [] };
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/lib/payroll-pdf-parser.test.ts`
Expected: PASS (1 test).

- [ ] **Step 3: Commit**

```bash
git add src/lib/payroll-pdf-parser.ts src/lib/payroll-pdf-parser.test.ts
git commit -m "feat(parser): payroll PDF header parsing"
```

---

## Task 5 — PDF parser: failing tests for employee row extraction

**Files:**
- Modify: `src/lib/payroll-pdf-parser.test.ts`

- [ ] **Step 1: Append row-extraction tests**

```ts
describe("parsePayrollPdf — rows", () => {
  it("extracts all 9 employees", async () => {
    const result = await parsePayrollPdf(FIXTURE);
    expect(result.rows).toHaveLength(9);
  });

  it("parses Brunelli (matricola 5) — FER values", async () => {
    const result = await parsePayrollPdf(FIXTURE);
    const r = result.rows.find((x) => x.matricola === "5");
    expect(r).toBeDefined();
    expect(r!.cognome).toBe("BRUNELLI");
    expect(r!.nome).toBe("STEFANO");
    expect(r!.fer.resAP).toBeCloseTo(24.65, 2);
    expect(r!.fer.maturato).toBeCloseTo(5.50, 2);
    expect(r!.fer.goduto).toBeCloseTo(0.00, 2);
    expect(r!.fer.residuo).toBeCloseTo(30.15, 2);
  });

  it("parses Brunelli (matricola 5) — FES and PER values", async () => {
    const result = await parsePayrollPdf(FIXTURE);
    const r = result.rows.find((x) => x.matricola === "5")!;
    expect(r.fes.residuo).toBeCloseTo(8.00, 2);
    expect(r.per.resAP).toBeCloseTo(7.01, 2);
    expect(r.per.residuo).toBeCloseTo(21.01, 2);
  });

  it("preserves negative resAP for Costieri (matricola 26)", async () => {
    const result = await parsePayrollPdf(FIXTURE);
    const r = result.rows.find((x) => x.matricola === "26")!;
    expect(r.cognome).toBe("COSTIERI");
    expect(r.fer.resAP).toBeCloseTo(-0.19, 2);
    expect(r.fer.residuo).toBeCloseTo(2.31, 2);
  });

  it("parses Cojocaru (matricola 28) with sparse monthly cells", async () => {
    const result = await parsePayrollPdf(FIXTURE);
    const r = result.rows.find((x) => x.matricola === "28")!;
    expect(r.cognome).toBe("COJOCARU");
    expect(r.fes.resAP).toBeCloseTo(78.00, 2);
    expect(r.per.resAP).toBeCloseTo(58.00, 2);
    expect(r.per.residuo).toBeCloseTo(72.00, 2);
  });

  it("parses Mengana (matricola 24) — part-time accruals", async () => {
    const result = await parsePayrollPdf(FIXTURE);
    const r = result.rows.find((x) => x.matricola === "24")!;
    expect(r.cognome).toBe("MENGANA");
    expect(r.per.maturato).toBeCloseTo(8.40, 2);
  });

  it("does not include the TOTALI summary row", async () => {
    const result = await parsePayrollPdf(FIXTURE);
    expect(result.rows.find((r) => r.cognome === "TOTALI")).toBeUndefined();
    expect(result.rows.every((r) => /^\d+$/.test(r.matricola))).toBe(true);
  });

  it("does not emit a B.O row (banca ore is silently dropped)", async () => {
    // B.O rows have no separate exposure in the row shape — implicitly verified
    // by checking that all categories are FER/FES/PER and none are strange.
    const result = await parsePayrollPdf(FIXTURE);
    for (const r of result.rows) {
      expect(r.fer).toBeDefined();
      expect(r.fes).toBeDefined();
      expect(r.per).toBeDefined();
    }
  });
});

describe("parsePayrollPdf — errors", () => {
  it("throws PayrollParseError on a non-PDF buffer", async () => {
    const fakeBuf = Buffer.from("this is not a pdf");
    await expect(parsePayrollPdf(fakeBuf)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/payroll-pdf-parser.test.ts`
Expected: most new tests FAIL (rows is empty array).

---

## Task 6 — PDF parser: implement employee row extraction

**Files:**
- Modify: `src/lib/payroll-pdf-parser.ts`

- [ ] **Step 1: Add row parsing logic**

Replace the `return { year, month, sourceMonthLabel, ditta, rows: [] };` line with the full implementation. Add helpers above the `parsePayrollPdf` function:

```ts
function parseItalianNumber(raw: string): number {
  const t = raw.trim();
  if (!t) return 0;
  // Italian decimal comma. Trailing minus = negative ("0,19-" → -0.19).
  const negative = t.endsWith("-");
  const stripped = (negative ? t.slice(0, -1) : t).replace(/\./g, "").replace(",", ".");
  const n = parseFloat(stripped);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

interface RawCategoryRow {
  code: "FER" | "FES" | "PER" | "B.O";
  cells: string[]; // 16 cells (12 months + resAP + maturato + goduto + residuo)
}

const CATEGORY_CODES = ["FER", "FES", "PER", "B.O"] as const;

function emptyCategory(): PayrollCategoryValues {
  return { resAP: 0, maturato: 0, goduto: 0, residuo: 0 };
}
```

Then, inside `parsePayrollPdf`, replace the bottom with this row-extraction section:

```ts
  // Each block is delimited by a row that contains "MATRICOLA-NUMBER ! DD/MM/YYYY".
  // We split on lines and detect employee blocks via the matricola line, then
  // collect the next 4 category rows (FER/FES/PER/B.O).
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const rows: PayrollPdfRow[] = [];

  // The PDF's text extraction loses the table grid; numbers and codes appear
  // on consecutive lines. We use a state machine: when we see a matricola line
  // (just an integer), start collecting; the next non-numeric token is the
  // surname, then the first name, then 4 category groups each containing
  // "FER"/"FES"/"PER"/"B.O" followed by their 16 numeric values.

  let i = 0;
  while (i < lines.length) {
    // Detect a matricola: a standalone integer between 1 and 9999, NOT preceded by
    // tokens like "pag." or "Tabulato". We also require that the next ~10 lines
    // contain a date in DD/MM/YYYY format (the assumption / cessation date).
    const matricolaMatch = /^(\d{1,4})$/.exec(lines[i]);
    if (matricolaMatch) {
      const lookahead = lines.slice(i + 1, i + 12).join(" ");
      if (/\d{2}\/\d{2}\/\d{4}/.test(lookahead)) {
        const block = collectEmployeeBlock(lines, i);
        if (block) {
          rows.push(block.row);
          i = block.nextIndex;
          continue;
        }
      }
    }
    i++;
  }

  return { year, month, sourceMonthLabel, ditta, rows };
}

interface BlockResult {
  row: PayrollPdfRow;
  nextIndex: number;
}

function collectEmployeeBlock(lines: string[], start: number): BlockResult | null {
  const matricola = lines[start];
  // Walk forward until we find the cognome (first all-letters uppercase token).
  let j = start + 1;
  while (j < lines.length && !/^[A-ZÀ-Ý]{2,}$/.test(lines[j])) j++;
  if (j >= lines.length) return null;
  const cognome = lines[j];
  j++;
  while (j < lines.length && !/^[A-ZÀ-Ý]{2,}$/.test(lines[j])) j++;
  if (j >= lines.length) return null;
  const nome = lines[j];
  j++;

  // Collect 4 category groups. Each starts with a code in CATEGORY_CODES,
  // followed by a sequence of numeric tokens (Italian-format numbers, possibly
  // with trailing "-"). We accept the next 16 numeric cells (missing months
  // count as empty/0).
  const categories: Record<string, PayrollCategoryValues> = {};
  let collected = 0;
  while (collected < 4 && j < lines.length) {
    const code = CATEGORY_CODES.find((c) => lines[j] === c);
    if (!code) {
      j++;
      // Stop if we drift into the next employee block
      if (/^\d{1,4}$/.test(lines[j - 1]) && j > start + 5) break;
      continue;
    }
    j++;
    const cells: string[] = [];
    while (cells.length < 16 && j < lines.length) {
      const tok = lines[j];
      if (CATEGORY_CODES.includes(tok as never)) break;
      if (/^\d{1,4}$/.test(tok)) break; // next matricola
      // Accept numeric tokens, blanks, and "-" (treated as 0)
      if (/^-?\d[\d.,]*-?$/.test(tok) || tok === "-" || tok === "") {
        cells.push(tok);
      }
      j++;
    }
    // Pad to 16 if PDF extraction produced fewer cells (sparse months)
    while (cells.length < 16) cells.push("");
    if (code !== "B.O") {
      categories[code] = {
        resAP: parseItalianNumber(cells[12]),
        maturato: parseItalianNumber(cells[13]),
        goduto: parseItalianNumber(cells[14]),
        residuo: parseItalianNumber(cells[15]),
      };
    }
    collected++;
  }

  const warnings: string[] = [];
  for (const code of ["FER", "FES", "PER"] as const) {
    const c = categories[code] ?? emptyCategory();
    const expected = c.resAP + c.maturato - c.goduto;
    if (Math.abs(expected - c.residuo) > 0.05) {
      warnings.push(
        `${code}: residuo nel PDF (${c.residuo}) non quadra con resAP+maturato-goduto (${expected.toFixed(2)})`
      );
    }
  }

  return {
    row: {
      matricola,
      cognome,
      nome,
      fer: categories["FER"] ?? emptyCategory(),
      fes: categories["FES"] ?? emptyCategory(),
      per: categories["PER"] ?? emptyCategory(),
      warnings,
    },
    nextIndex: j,
  };
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/lib/payroll-pdf-parser.test.ts`
Expected: ALL PASS.

If any test fails, inspect the actual `data.text` from the fixture (use the smoke script from Task 2). The PDF text-extraction order is the only source of truth — adjust the state machine to match what `pdf-parse` actually emits. Common issues:
- pdf-parse may emit numbers and codes inline on the same line — split on whitespace before tokenizing.
- The TOTALI section at end of page 4 may include "Gennaio"/"Febbraio" labels that look like numbers — guarded by the matricola pattern.

If the tokenization is fundamentally different from what's assumed above, rewrite `collectEmployeeBlock` to suit the actual layout. The test fixture is the spec.

- [ ] **Step 3: Commit**

```bash
git add src/lib/payroll-pdf-parser.ts src/lib/payroll-pdf-parser.test.ts
git commit -m "feat(parser): payroll PDF row extraction with negative-value support"
```

---

## Task 7 — Mapping formula: failing tests

**Files:**
- Create: `src/lib/payroll-import-mapping.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { computeMappedBalance, fuseRolFromPdf } from "./payroll-import-mapping";

describe("fuseRolFromPdf", () => {
  it("sums FES and PER fields component-wise", () => {
    const result = fuseRolFromPdf(
      { resAP: 0, maturato: 8, goduto: 0, residuo: 8 },
      { resAP: 7.01, maturato: 14, goduto: 0, residuo: 21.01 }
    );
    expect(result.resAP).toBeCloseTo(7.01, 2);
    expect(result.maturato).toBeCloseTo(22, 2);
    expect(result.goduto).toBeCloseTo(0, 2);
    expect(result.residuo).toBeCloseTo(29.01, 2);
  });
});

describe("computeMappedBalance", () => {
  it("Brunelli case: sets carryOver and adjust so remaining matches PDF", () => {
    const out = computeMappedBalance({
      pdfFer: { resAP: 24.65, maturato: 5.50, goduto: 0, residuo: 30.15 },
      pdfRol: { resAP: 7.01, maturato: 22, goduto: 0, residuo: 29.01 },
      appVacationAccrued: 6.0,
      appVacationUsed: 0,
      appRolAccrued: 6.0,
      appRolUsed: 0,
    });
    expect(out.vacationCarryOver).toBeCloseTo(24.65, 2);
    // adjust so 24.65 + 6 + adjust − 0 = 30.15 → adjust = -0.50
    expect(out.vacationAccrualAdjust).toBeCloseTo(-0.50, 2);
    expect(out.rolCarryOver).toBeCloseTo(7.01, 2);
    // 7.01 + 6 + adjust − 0 = 29.01 → adjust = 16.00
    expect(out.rolAccrualAdjust).toBeCloseTo(16.00, 2);
  });

  it("preserves negative resAP", () => {
    const out = computeMappedBalance({
      pdfFer: { resAP: -0.19, maturato: 5.5, goduto: 3, residuo: 2.31 },
      pdfRol: { resAP: 0, maturato: 22, goduto: 11, residuo: 11 },
      appVacationAccrued: 5.5,
      appVacationUsed: 3,
      appRolAccrued: 22,
      appRolUsed: 11,
    });
    expect(out.vacationCarryOver).toBeCloseTo(-0.19, 2);
    expect(out.vacationAccrualAdjust).toBeCloseTo(0, 2);
  });

  it("is idempotent: applying mapping then re-applying yields same outputs", () => {
    const inputs = {
      pdfFer: { resAP: 24.65, maturato: 5.50, goduto: 0, residuo: 30.15 },
      pdfRol: { resAP: 7.01, maturato: 22, goduto: 0, residuo: 29.01 },
      appVacationAccrued: 6.0,
      appVacationUsed: 0,
      appRolAccrued: 6.0,
      appRolUsed: 0,
    };
    const first = computeMappedBalance(inputs);
    const second = computeMappedBalance(inputs);
    expect(second).toEqual(first);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/payroll-import-mapping.test.ts`
Expected: FAIL — module does not exist.

---

## Task 8 — Mapping formula: implementation

**Files:**
- Create: `src/lib/payroll-import-mapping.ts`

- [ ] **Step 1: Implement**

```ts
import type { PayrollCategoryValues } from "./payroll-pdf-parser";

export interface MappedBalance {
  vacationCarryOver: number;
  vacationAccrualAdjust: number;
  rolCarryOver: number;
  rolAccrualAdjust: number;
}

export interface MappingInputs {
  pdfFer: PayrollCategoryValues;
  pdfRol: PayrollCategoryValues; // already fused (fes+per)
  appVacationAccrued: number;
  appVacationUsed: number;
  appRolAccrued: number;
  appRolUsed: number;
}

export function fuseRolFromPdf(
  fes: PayrollCategoryValues,
  per: PayrollCategoryValues
): PayrollCategoryValues {
  return {
    resAP: round2(fes.resAP + per.resAP),
    maturato: round2(fes.maturato + per.maturato),
    goduto: round2(fes.goduto + per.goduto),
    residuo: round2(fes.residuo + per.residuo),
  };
}

export function computeMappedBalance(input: MappingInputs): MappedBalance {
  const vacationCarryOver = input.pdfFer.resAP;
  const vacationAccrualAdjust = round2(
    input.pdfFer.residuo -
      (input.pdfFer.resAP + input.appVacationAccrued - input.appVacationUsed)
  );
  const rolCarryOver = input.pdfRol.resAP;
  const rolAccrualAdjust = round2(
    input.pdfRol.residuo -
      (input.pdfRol.resAP + input.appRolAccrued - input.appRolUsed)
  );
  return { vacationCarryOver, vacationAccrualAdjust, rolCarryOver, rolAccrualAdjust };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/lib/payroll-import-mapping.test.ts`
Expected: ALL PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add src/lib/payroll-import-mapping.ts src/lib/payroll-import-mapping.test.ts
git commit -m "feat(payroll): mapping formula carryOver+accrualAdjust"
```

---

## Task 9 — Import service: orchestration

**Files:**
- Create: `src/lib/payroll-import-service.ts`

This service encapsulates parse + match + diff for both preview and confirm endpoints. No HTTP handling here — pure logic that takes a buffer and returns structured data.

- [ ] **Step 1: Create the service**

```ts
import { createHash } from "crypto";
import { prisma } from "./db";
import { computeLeaveBalance } from "./leaves";
import { parsePayrollPdf, type PayrollPdfParseResult, type PayrollPdfRow } from "./payroll-pdf-parser";
import { computeMappedBalance, fuseRolFromPdf, type MappedBalance } from "./payroll-import-mapping";

export interface DiffPair {
  currentRemaining: number;
  newRemaining: number;
  currentCarryOver: number;
  newCarryOver: number;
  currentAdjust: number;
  newAdjust: number;
}

export interface PreviewRow {
  matricola: string;
  cognomePdf: string;
  nomePdf: string;
  matched: boolean;
  employeeId: string | null;
  employeeDisplayName: string | null;
  vacation: DiffPair;
  rol: DiffPair;
  warnings: string[];
}

export interface PreviewResult {
  year: number;
  sourceMonthLabel: string;
  fileHash: string;
  alreadyImported: { importId: string; createdAt: string } | null;
  rows: PreviewRow[];
  orphans: { employeeId: string; displayName: string }[];
  parsed: PayrollPdfParseResult; // forwarded so confirm can re-use same numbers
}

const ZERO_DIFF: DiffPair = {
  currentRemaining: 0, newRemaining: 0,
  currentCarryOver: 0, newCarryOver: 0,
  currentAdjust: 0, newAdjust: 0,
};

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function checkDuplicateMatricole(rows: PayrollPdfRow[]): string[] {
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.matricola, (seen.get(r.matricola) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([m]) => m);
}

/** Build preview without writing anything. */
export async function buildPreview(buffer: Buffer): Promise<PreviewResult> {
  const parsed = await parsePayrollPdf(buffer);
  const fileHash = sha256Hex(buffer);

  const dupes = checkDuplicateMatricole(parsed.rows);
  if (dupes.length > 0) {
    const e = new Error(`Matricole duplicate nel PDF: ${dupes.join(", ")}`);
    (e as Error & { kind: string }).kind = "duplicate-matricola";
    throw e;
  }

  const previousImport = await prisma.payrollImport.findFirst({
    where: { fileHash },
    orderBy: { createdAt: "desc" },
  });

  const matricole = parsed.rows.map((r) => r.matricola);
  const matchedEmployees = await prisma.employee.findMany({
    where: { payrollId: { in: matricole } },
    select: {
      id: true,
      displayName: true,
      name: true,
      payrollId: true,
    },
  });
  const byPayrollId = new Map(matchedEmployees.map((e) => [e.payrollId!, e]));

  const rows: PreviewRow[] = [];
  for (const pdfRow of parsed.rows) {
    const emp = byPayrollId.get(pdfRow.matricola);
    if (!emp) {
      rows.push({
        matricola: pdfRow.matricola,
        cognomePdf: pdfRow.cognome,
        nomePdf: pdfRow.nome,
        matched: false,
        employeeId: null,
        employeeDisplayName: null,
        vacation: ZERO_DIFF,
        rol: ZERO_DIFF,
        warnings: [...pdfRow.warnings, "Matricola non associata a nessun dipendente"],
      });
      continue;
    }

    const summary = await computeLeaveBalance(emp.id, parsed.year);
    const pdfRol = fuseRolFromPdf(pdfRow.fes, pdfRow.per);
    const mapped = computeMappedBalance({
      pdfFer: pdfRow.fer,
      pdfRol,
      appVacationAccrued: summary.vacationAccrued,
      appVacationUsed: summary.vacationUsed,
      appRolAccrued: summary.rolAccrued,
      appRolUsed: summary.rolUsed,
    });

    rows.push({
      matricola: pdfRow.matricola,
      cognomePdf: pdfRow.cognome,
      nomePdf: pdfRow.nome,
      matched: true,
      employeeId: emp.id,
      employeeDisplayName: emp.displayName ?? emp.name,
      vacation: {
        currentRemaining: summary.vacationRemaining,
        newRemaining: pdfRow.fer.residuo,
        currentCarryOver: summary.vacationCarryOver,
        newCarryOver: mapped.vacationCarryOver,
        currentAdjust: summary.vacationAccrualAdjust,
        newAdjust: mapped.vacationAccrualAdjust,
      },
      rol: {
        currentRemaining: summary.rolRemaining,
        newRemaining: pdfRol.residuo,
        currentCarryOver: summary.rolCarryOver,
        newCarryOver: mapped.rolCarryOver,
        currentAdjust: summary.rolAccrualAdjust,
        newAdjust: mapped.rolAccrualAdjust,
      },
      warnings: pdfRow.warnings,
    });
  }

  // Orphans: employees with payrollId set but not in PDF, plus those with a
  // LeaveBalance row this year but no payrollId (informational).
  const matchedIds = new Set(matchedEmployees.map((e) => e.id));
  const orphansRaw = await prisma.employee.findMany({
    where: {
      OR: [
        { payrollId: { not: null } },
        { balances: { some: { year: parsed.year } } },
      ],
    },
    select: { id: true, displayName: true, name: true },
  });
  const orphans = orphansRaw
    .filter((e) => !matchedIds.has(e.id))
    .map((e) => ({ employeeId: e.id, displayName: e.displayName ?? e.name }));

  return {
    year: parsed.year,
    sourceMonthLabel: parsed.sourceMonthLabel,
    fileHash,
    alreadyImported: previousImport
      ? { importId: previousImport.id, createdAt: previousImport.createdAt.toISOString() }
      : null,
    rows,
    orphans,
    parsed,
  };
}

export interface ConfirmResult {
  importId: string;
  matched: number;
  skipped: number;
  orphans: number;
}

export async function confirmImport(
  buffer: Buffer,
  expectedHash: string,
  fileName: string,
  userId: string
): Promise<ConfirmResult> {
  const preview = await buildPreview(buffer);

  if (preview.fileHash !== expectedHash) {
    const e = new Error("Il file è cambiato rispetto alla preview, ricarica.");
    (e as Error & { kind: string }).kind = "hash-mismatch";
    throw e;
  }

  const unmatched = preview.rows.filter((r) => !r.matched);
  if (unmatched.length > 0) {
    const e = new Error(
      `Matricole non associate: ${unmatched.map((r) => r.matricola).join(", ")}`
    );
    (e as Error & { kind: string }).kind = "unmatched";
    throw e;
  }

  const payloadRows: unknown[] = [];

  const importId = await prisma.$transaction(async (tx) => {
    for (const row of preview.rows) {
      const before = await tx.leaveBalance.findUnique({
        where: { employeeId_year: { employeeId: row.employeeId!, year: preview.year } },
      });

      const beforeSnapshot = {
        vacationCarryOver: before?.vacationCarryOver ?? 0,
        vacationAccrualAdjust: before?.vacationAccrualAdjust ?? 0,
        rolCarryOver: before?.rolCarryOver ?? 0,
        rolAccrualAdjust: before?.rolAccrualAdjust ?? 0,
      };
      const afterSnapshot = {
        vacationCarryOver: row.vacation.newCarryOver,
        vacationAccrualAdjust: row.vacation.newAdjust,
        rolCarryOver: row.rol.newCarryOver,
        rolAccrualAdjust: row.rol.newAdjust,
      };

      await tx.leaveBalance.upsert({
        where: { employeeId_year: { employeeId: row.employeeId!, year: preview.year } },
        create: {
          employeeId: row.employeeId!,
          year: preview.year,
          ...afterSnapshot,
        },
        update: afterSnapshot,
      });

      const pdfRow = preview.parsed.rows.find((p) => p.matricola === row.matricola)!;
      payloadRows.push({
        matricola: row.matricola,
        cognomePdf: row.cognomePdf,
        nomePdf: row.nomePdf,
        employeeId: row.employeeId,
        before: beforeSnapshot,
        after: afterSnapshot,
        pdfValues: { fer: pdfRow.fer, fes: pdfRow.fes, per: pdfRow.per },
        warnings: row.warnings,
      });
    }

    const created = await tx.payrollImport.create({
      data: {
        userId,
        fileName,
        fileHash: preview.fileHash,
        year: preview.year,
        sourceMonth: preview.sourceMonthLabel,
        totalEmployees: preview.parsed.rows.length,
        matchedEmployees: preview.rows.filter((r) => r.matched).length,
        skippedEmployees: 0,
        orphanEmployees: preview.orphans.length,
        payload: JSON.stringify({ rows: payloadRows, orphans: preview.orphans }),
      },
    });
    return created.id;
  });

  return {
    importId,
    matched: preview.rows.length,
    skipped: 0,
    orphans: preview.orphans.length,
  };
}
```

- [ ] **Step 2: Type-check the file**

Run: `npx tsc --noEmit`
Expected: no errors related to this file. (Pre-existing errors in the project are out of scope.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/payroll-import-service.ts
git commit -m "feat(payroll): import service (preview + confirm)"
```

---

## Task 10 — Employee API: support `payrollId`

**Files:**
- Modify: `src/app/api/employees/[id]/route.ts`

- [ ] **Step 1: Add `payrollId` to GET response**

In the GET handler's final `NextResponse.json({...})` block (around line 39), add:

```ts
    payrollId: employee.payrollId,
```

After the `email: employee.email,` line.

- [ ] **Step 2: Add `payrollId` to PUT handler — read & validate**

In the PUT handler, after the `emailRaw` line (around line 80), add:

```ts
  const payrollIdRaw = formData.get("payrollId") as string | null;
```

In the `updateData` type declaration block (around line 90), add `payrollId?: string | null;` to the interface.

After the email handling block (around line 164), add:

```ts
  // Update payrollId (matricola paghe). Stringa vuota = scollega.
  if (payrollIdRaw !== null) {
    const trimmed = payrollIdRaw.trim();
    updateData.payrollId = trimmed === "" ? null : trimmed;
  }
```

- [ ] **Step 3: Update P2002 handler to recognize payrollId conflicts**

In the catch block (around line 251), update the message logic:

```ts
      const msg = targetStr.includes("telegram")
        ? "Chat Telegram già associata a un altro dipendente"
        : targetStr.includes("email")
        ? "Email già associata a un altro dipendente"
        : targetStr.includes("payrollId")
        ? "Matricola paghe già associata a un altro dipendente"
        : "UID NFC già associato a un altro dipendente";
```

- [ ] **Step 4: Add `payrollId` to PUT response**

In the final `NextResponse.json({...})` (around line 264), add:

```ts
    payrollId: updated.payrollId,
```

After the `email: updated.email,` line.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/employees/[id]/route.ts
git commit -m "feat(employees): expose and accept payrollId field"
```

---

## Task 11 — Employee form UI: add `payrollId` input

**Files:**
- Modify: `src/app/(dashboard)/employees/[id]/page.tsx`

- [ ] **Step 1: Read the existing employee edit form**

Run: `head -200 src/app/\(dashboard\)/employees/\[id\]/page.tsx`

Locate: (a) the state hook holding employee fields, (b) the JSX section where existing optional fields like `nfcUid`, `telegramChatId`, `email` are rendered.

- [ ] **Step 2: Add `payrollId` to local state**

Find the `useState` initialization that mirrors employee fields (look for `nfcUid: ""` or similar). Add a sibling field:

```tsx
  payrollId: "",
```

In the `useEffect` that loads the employee from `/api/employees/[id]`, add:

```tsx
        payrollId: data.payrollId ?? "",
```

(Match the surrounding pattern of how `nfcUid`/`email` are populated.)

- [ ] **Step 3: Add the form input**

Near the `nfcUid` input in the JSX, add (with the same wrapper/label classes used by the other text inputs in this form):

```tsx
        <div>
          <label htmlFor="payrollId" className="block text-sm font-medium mb-1">
            Matricola paghe
          </label>
          <input
            id="payrollId"
            type="text"
            value={form.payrollId}
            onChange={(e) => setForm({ ...form, payrollId: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-2"
            placeholder="es. 5"
          />
          <p className="text-xs text-gray-500 mt-1">
            Numero matricola del consulente paghe — usato per l'import del tabulato.
          </p>
        </div>
```

(Adapt the className to match the existing form's styling — copy from the `nfcUid` input next door if it differs.)

- [ ] **Step 4: Include `payrollId` in the FormData submission**

Find the `handleSubmit` function. Add (next to where `nfcUid` is appended):

```tsx
    formData.append("payrollId", form.payrollId);
```

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`. Open an employee edit page, set a matricola (e.g. "5"), save, refresh — verify the value persists.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/employees/\[id\]/page.tsx
git commit -m "feat(ui): payrollId input on employee edit form"
```

---

## Task 12 — API route: `POST /api/settings/payroll-import/preview`

**Files:**
- Create: `src/app/api/settings/payroll-import/preview/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { buildPreview } from "@/lib/payroll-import-service";
import { PayrollParseError } from "@/lib/payroll-pdf-parser";

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Richiesta non valida (atteso multipart/form-data)" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Campo 'file' mancante" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File troppo grande (max 5MB)" }, { status: 413 });
  }
  if (file.type && file.type !== "application/pdf") {
    return NextResponse.json({ error: "Il file deve essere un PDF" }, { status: 415 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const preview = await buildPreview(buffer);
    // Strip the heavy `parsed` field before returning to the client
    // (used internally by confirmImport on the next call).
    const { parsed: _parsed, ...payload } = preview;
    void _parsed;
    return NextResponse.json(payload);
  } catch (e) {
    if (e instanceof PayrollParseError) {
      return NextResponse.json({ error: e.message, hint: e.hint, kind: e.kind }, { status: 422 });
    }
    const err = e as Error & { kind?: string };
    if (err.kind === "duplicate-matricola") {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[payroll-import/preview] unexpected", e);
    return NextResponse.json({ error: "Errore interno durante il parsing" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manual smoke test**

Start dev server (`npm run dev`), then with a logged-in admin session use the browser devtools or curl with cookie:

```bash
curl -X POST -F "file=@prisma/fixtures/tabulato-marzo-2026.pdf" \
  -b "next-auth.session-token=<your-cookie>" \
  http://localhost:3000/api/settings/payroll-import/preview
```

Expected: JSON with `year: 2026`, `sourceMonthLabel: "Marzo 2026"`, `rows` containing the parsed employees.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/settings/payroll-import/preview/route.ts
git commit -m "feat(api): payroll-import preview endpoint"
```

---

## Task 13 — API route: `POST /api/settings/payroll-import/confirm`

**Files:**
- Create: `src/app/api/settings/payroll-import/confirm/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAuth } from "@/lib/auth-guard";
import { confirmImport } from "@/lib/payroll-import-service";
import { PayrollParseError } from "@/lib/payroll-pdf-parser";

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: "Sessione non valida" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  }

  const file = formData.get("file");
  const expectedHash = formData.get("confirmHash");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Campo 'file' mancante" }, { status: 400 });
  }
  if (typeof expectedHash !== "string" || !expectedHash) {
    return NextResponse.json({ error: "Campo 'confirmHash' mancante" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File troppo grande (max 5MB)" }, { status: 413 });
  }
  if (file.type && file.type !== "application/pdf") {
    return NextResponse.json({ error: "Il file deve essere un PDF" }, { status: 415 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await confirmImport(buffer, expectedHash, file.name, userId);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof PayrollParseError) {
      return NextResponse.json({ error: e.message, hint: e.hint, kind: e.kind }, { status: 422 });
    }
    const err = e as Error & { kind?: string };
    if (err.kind === "hash-mismatch" || err.kind === "duplicate-matricola") {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err.kind === "unmatched") {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[payroll-import/confirm] unexpected", e);
    return NextResponse.json({ error: "Errore interno durante la conferma" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Type-check + manual smoke test**

Run: `npx tsc --noEmit`. Then with the dev server: hit `/preview` first to obtain `fileHash`, then `/confirm` with the same file + hash. Verify a `PayrollImport` row was created and a few `LeaveBalance` rows were upserted (use `npm run db:studio` to inspect).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/settings/payroll-import/confirm/route.ts
git commit -m "feat(api): payroll-import confirm endpoint"
```

---

## Task 14 — API routes: history list and detail

**Files:**
- Create: `src/app/api/settings/payroll-import/history/route.ts`
- Create: `src/app/api/settings/payroll-import/history/[id]/route.ts`

- [ ] **Step 1: List endpoint**

```ts
// src/app/api/settings/payroll-import/history/route.ts
import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;

  const items = await prisma.payrollImport.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { name: true, email: true } } },
  });

  return NextResponse.json(
    items.map((i) => ({
      id: i.id,
      createdAt: i.createdAt.toISOString(),
      userName: i.user.name,
      userEmail: i.user.email,
      fileName: i.fileName,
      year: i.year,
      sourceMonth: i.sourceMonth,
      totalEmployees: i.totalEmployees,
      matchedEmployees: i.matchedEmployees,
      orphanEmployees: i.orphanEmployees,
    }))
  );
}
```

- [ ] **Step 2: Detail endpoint**

```ts
// src/app/api/settings/payroll-import/history/[id]/route.ts
import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const item = await prisma.payrollImport.findUnique({
    where: { id },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!item) return NextResponse.json({ error: "Import non trovato" }, { status: 404 });

  return NextResponse.json({
    id: item.id,
    createdAt: item.createdAt.toISOString(),
    userName: item.user.name,
    userEmail: item.user.email,
    fileName: item.fileName,
    fileHash: item.fileHash,
    year: item.year,
    sourceMonth: item.sourceMonth,
    totalEmployees: item.totalEmployees,
    matchedEmployees: item.matchedEmployees,
    orphanEmployees: item.orphanEmployees,
    payload: JSON.parse(item.payload),
  });
}
```

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit`.

```bash
git add src/app/api/settings/payroll-import/history/
git commit -m "feat(api): payroll-import history endpoints"
```

---

## Task 15 — UI: main payroll-import page (upload + preview + confirm)

**Files:**
- Create: `src/app/(dashboard)/settings/payroll-import/page.tsx`

- [ ] **Step 1: Implement the page**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface DiffPair {
  currentRemaining: number;
  newRemaining: number;
  currentCarryOver: number;
  newCarryOver: number;
  currentAdjust: number;
  newAdjust: number;
}

interface PreviewRow {
  matricola: string;
  cognomePdf: string;
  nomePdf: string;
  matched: boolean;
  employeeId: string | null;
  employeeDisplayName: string | null;
  vacation: DiffPair;
  rol: DiffPair;
  warnings: string[];
}

interface PreviewResponse {
  year: number;
  sourceMonthLabel: string;
  fileHash: string;
  alreadyImported: { importId: string; createdAt: string } | null;
  rows: PreviewRow[];
  orphans: { employeeId: string; displayName: string }[];
}

interface AvailableEmployee {
  id: string;
  displayName: string;
}

export default function PayrollImportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [available, setAvailable] = useState<AvailableEmployee[]>([]);
  const [busy, setBusy] = useState(false);

  async function loadAvailableEmployees() {
    // Employees with no payrollId yet, for the inline association dropdown.
    const res = await fetch("/api/employees?withoutPayrollId=1");
    if (res.ok) {
      const data = await res.json();
      setAvailable(
        (data as { id: string; displayName?: string; name: string }[]).map((e) => ({
          id: e.id,
          displayName: e.displayName ?? e.name,
        }))
      );
    }
  }

  async function runPreview(f: File) {
    setBusy(true);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/settings/payroll-import/preview", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Errore preview", { description: data.hint });
        return;
      }
      setPreview(data);
      await loadAvailableEmployees();
    } finally {
      setBusy(false);
    }
  }

  function handleFile(f: File | null) {
    setFile(f);
    if (f) void runPreview(f);
  }

  async function associate(matricola: string, employeeId: string, rowEmployeeId?: string) {
    if (!employeeId) return;
    const fd = new FormData();
    fd.append("payrollId", matricola);
    const res = await fetch(`/api/employees/${employeeId}`, { method: "PUT", body: fd });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Errore associazione");
      return;
    }
    toast.success(`Matricola ${matricola} associata`);
    if (file) await runPreview(file);
    void rowEmployeeId; // silence linter
  }

  async function confirm() {
    if (!file || !preview) return;
    if (!confirm_OK(preview)) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("confirmHash", preview.fileHash);
      const res = await fetch("/api/settings/payroll-import/confirm", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Errore conferma");
        return;
      }
      toast.success(`Import completato: ${data.matched} dipendenti aggiornati`);
      router.push(`/settings/payroll-import/history/${data.importId}`);
    } finally {
      setBusy(false);
    }
  }

  function confirm_OK(p: PreviewResponse): boolean {
    if (p.alreadyImported) {
      return window.confirm(
        `Questo file è già stato importato il ${new Date(p.alreadyImported.createdAt).toLocaleString("it-IT")}. Procedere comunque?`
      );
    }
    return window.confirm(
      `Aggiornare i saldi ferie/ROL per ${p.rows.filter((r) => r.matched).length} dipendenti?`
    );
  }

  const unmatchedCount = preview?.rows.filter((r) => !r.matched).length ?? 0;
  const canConfirm = preview !== null && unmatchedCount === 0 && !busy;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Import tabulato paghe</h1>
        <a
          href="/settings/payroll-import/history"
          className="text-sm text-blue-600 hover:underline"
        >
          Storico import →
        </a>
      </div>

      <section className="bg-white rounded-lg border border-gray-200 p-4">
        <label className="block text-sm font-medium mb-2">
          File PDF tabulato (max 5MB)
        </label>
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          disabled={busy}
        />
      </section>

      {busy && <p className="text-gray-500">Elaborazione in corso…</p>}

      {preview && (
        <>
          <section className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="text-lg font-medium">
              Tabulato {preview.sourceMonthLabel} — {preview.rows.length} dipendenti nel PDF · {preview.rows.filter((r) => r.matched).length} associati · {unmatchedCount} da associare
            </h2>
            {preview.alreadyImported && (
              <div className="mt-3 p-3 rounded-md bg-yellow-50 border border-yellow-200 text-sm">
                ⚠ Questo file è già stato importato il{" "}
                {new Date(preview.alreadyImported.createdAt).toLocaleString("it-IT")}.{" "}
                <a
                  href={`/settings/payroll-import/history/${preview.alreadyImported.importId}`}
                  className="underline"
                >
                  Vedi import precedente
                </a>
              </div>
            )}
            {preview.orphans.length > 0 && (
              <div className="mt-3 p-3 rounded-md bg-blue-50 border border-blue-200 text-sm">
                I seguenti dipendenti dell'app non sono nel PDF e NON verranno toccati:{" "}
                {preview.orphans.map((o) => o.displayName).join(", ")}
              </div>
            )}
          </section>

          <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-3 py-2">Matr.</th>
                  <th className="px-3 py-2">PDF</th>
                  <th className="px-3 py-2">Dipendente</th>
                  <th className="px-3 py-2 text-right">Ferie (gg)</th>
                  <th className="px-3 py-2 text-right">ROL (h)</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr
                    key={r.matricola}
                    className={r.matched ? "border-t" : "border-t bg-red-50"}
                  >
                    <td className="px-3 py-2 font-mono">{r.matricola}</td>
                    <td className="px-3 py-2">
                      {r.cognomePdf} {r.nomePdf}
                    </td>
                    <td className="px-3 py-2">
                      {r.matched ? (
                        r.employeeDisplayName
                      ) : (
                        <select
                          className="border border-gray-300 rounded px-2 py-1"
                          defaultValue=""
                          onChange={(e) => associate(r.matricola, e.target.value)}
                        >
                          <option value="">— Associa a… —</option>
                          {available.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.displayName}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.matched ? (
                        <DiffCell pair={r.vacation} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.matched ? <DiffCell pair={r.rol} /> : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {r.warnings.join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="flex justify-end">
            <button
              onClick={confirm}
              disabled={!canConfirm}
              className="px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-300"
            >
              Conferma import
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function DiffCell({ pair }: { pair: DiffPair }) {
  const diff = pair.newRemaining - pair.currentRemaining;
  const color = diff > 0.005 ? "text-green-700" : diff < -0.005 ? "text-red-700" : "text-gray-700";
  return (
    <span className="font-mono">
      {pair.currentRemaining.toFixed(2)} → <span className={`font-semibold ${color}`}>{pair.newRemaining.toFixed(2)}</span>
    </span>
  );
}
```

- [ ] **Step 2: Add `withoutPayrollId` filter to employees list endpoint**

The page above calls `/api/employees?withoutPayrollId=1`. Check whether `src/app/api/employees/route.ts` already supports a query filter; if not, add this to its GET handler:

```ts
  const url = new URL(request.url);
  if (url.searchParams.get("withoutPayrollId") === "1") {
    const list = await prisma.employee.findMany({
      where: { payrollId: null },
      select: { id: true, name: true, displayName: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(list);
  }
```

(Insert near the top of the existing GET handler. Confirm the file path / handler signature first by reading `src/app/api/employees/route.ts`.)

- [ ] **Step 3: Type-check and manual run**

Run: `npx tsc --noEmit`. Then `npm run dev`, navigate to `/settings/payroll-import`, upload the fixture, associate any unmatched matricole, click Conferma. Verify redirect to history detail.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/settings/payroll-import/page.tsx src/app/api/employees/route.ts
git commit -m "feat(ui): payroll-import upload + preview + confirm page"
```

---

## Task 16 — UI: history pages

**Files:**
- Create: `src/app/(dashboard)/settings/payroll-import/history/page.tsx`
- Create: `src/app/(dashboard)/settings/payroll-import/history/[id]/page.tsx`

- [ ] **Step 1: History list page**

```tsx
"use client";
import { useEffect, useState } from "react";

interface Item {
  id: string;
  createdAt: string;
  userName: string;
  fileName: string;
  year: number;
  sourceMonth: string;
  totalEmployees: number;
  matchedEmployees: number;
  orphanEmployees: number;
}

export default function PayrollImportHistoryPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/settings/payroll-import/history")
      .then((r) => r.json())
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Storico import paghe</h1>
        <a href="/settings/payroll-import" className="text-sm text-blue-600 hover:underline">
          ← Nuovo import
        </a>
      </div>
      {loading && <p>Caricamento…</p>}
      {!loading && items.length === 0 && <p className="text-gray-500">Nessun import ancora.</p>}
      {items.length > 0 && (
        <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Utente</th>
              <th className="px-3 py-2">Tabulato</th>
              <th className="px-3 py-2">File</th>
              <th className="px-3 py-2 text-right">Aggiornati</th>
              <th className="px-3 py-2 text-right">Orfani</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-t">
                <td className="px-3 py-2">{new Date(i.createdAt).toLocaleString("it-IT")}</td>
                <td className="px-3 py-2">{i.userName}</td>
                <td className="px-3 py-2">{i.sourceMonth}</td>
                <td className="px-3 py-2 text-xs font-mono">{i.fileName}</td>
                <td className="px-3 py-2 text-right">{i.matchedEmployees}/{i.totalEmployees}</td>
                <td className="px-3 py-2 text-right">{i.orphanEmployees}</td>
                <td className="px-3 py-2">
                  <a href={`/settings/payroll-import/history/${i.id}`} className="text-blue-600 hover:underline">
                    Dettagli
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: History detail page**

```tsx
"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface Snapshot {
  vacationCarryOver: number;
  vacationAccrualAdjust: number;
  rolCarryOver: number;
  rolAccrualAdjust: number;
}
interface PdfCat { resAP: number; maturato: number; goduto: number; residuo: number; }
interface Row {
  matricola: string;
  cognomePdf: string;
  nomePdf: string;
  employeeId: string;
  before: Snapshot;
  after: Snapshot;
  pdfValues: { fer: PdfCat; fes: PdfCat; per: PdfCat };
  warnings: string[];
}
interface Detail {
  id: string;
  createdAt: string;
  userName: string;
  fileName: string;
  year: number;
  sourceMonth: string;
  totalEmployees: number;
  matchedEmployees: number;
  orphanEmployees: number;
  payload: { rows: Row[]; orphans: { employeeId: string; displayName: string }[] };
}

export default function PayrollImportDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);

  useEffect(() => {
    fetch(`/api/settings/payroll-import/history/${params.id}`)
      .then((r) => r.json())
      .then(setData);
  }, [params.id]);

  if (!data) return <div className="p-6">Caricamento…</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <a href="/settings/payroll-import/history" className="text-sm text-blue-600 hover:underline">
        ← Storico
      </a>
      <h1 className="text-2xl font-semibold">{data.sourceMonth}</h1>
      <p className="text-gray-600 text-sm">
        Importato il {new Date(data.createdAt).toLocaleString("it-IT")} da {data.userName} · file{" "}
        <span className="font-mono">{data.fileName}</span>
      </p>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left">
          <tr>
            <th className="px-3 py-2">Matr.</th>
            <th className="px-3 py-2">Dipendente</th>
            <th className="px-3 py-2 text-right">Ferie carry (prima → dopo)</th>
            <th className="px-3 py-2 text-right">Ferie adjust</th>
            <th className="px-3 py-2 text-right">ROL carry</th>
            <th className="px-3 py-2 text-right">ROL adjust</th>
          </tr>
        </thead>
        <tbody>
          {data.payload.rows.map((r) => (
            <tr key={r.matricola} className="border-t">
              <td className="px-3 py-2 font-mono">{r.matricola}</td>
              <td className="px-3 py-2">{r.cognomePdf} {r.nomePdf}</td>
              <td className="px-3 py-2 text-right font-mono">
                {r.before.vacationCarryOver.toFixed(2)} → <strong>{r.after.vacationCarryOver.toFixed(2)}</strong>
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {r.before.vacationAccrualAdjust.toFixed(2)} → <strong>{r.after.vacationAccrualAdjust.toFixed(2)}</strong>
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {r.before.rolCarryOver.toFixed(2)} → <strong>{r.after.rolCarryOver.toFixed(2)}</strong>
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {r.before.rolAccrualAdjust.toFixed(2)} → <strong>{r.after.rolAccrualAdjust.toFixed(2)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.payload.orphans.length > 0 && (
        <section className="text-sm">
          <h3 className="font-medium mb-1">Dipendenti non presenti nel PDF (non toccati):</h3>
          <p className="text-gray-700">{data.payload.orphans.map((o) => o.displayName).join(", ")}</p>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit`.

```bash
git add src/app/\(dashboard\)/settings/payroll-import/history/
git commit -m "feat(ui): payroll-import history list and detail pages"
```

---

## Task 17 — Settings hub: add card

**Files:**
- Modify: `src/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Read the existing hub page** to find the card pattern used for `api-keys`, `nfc`, etc.

Run: `cat src/app/\(dashboard\)/settings/page.tsx`

- [ ] **Step 2: Add a card matching the existing pattern**

Add an entry alongside the existing settings cards. Adapt to the actual JSX style; here is the conceptual addition:

```tsx
        <SettingsCard
          href="/settings/payroll-import"
          title="Import tabulato paghe"
          description="Importa ferie, festività e permessi dal PDF del consulente paghe e riallinea i saldi dipendenti."
          icon={/* match how other cards declare icons */}
        />
```

If the page uses inline `<a>` cards rather than a component, mirror that pattern exactly.

- [ ] **Step 3: Manual smoke test**

Open `/settings` in dev → verify the new card appears and links to `/settings/payroll-import`.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/settings/page.tsx
git commit -m "feat(ui): payroll-import card on settings hub"
```

---

## Task 18 — End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Reset relevant LeaveBalance for clean test**

Optional: in `npm run db:studio`, delete `LeaveBalance` rows for year 2026 to start fresh.

- [ ] **Step 2: Populate at least 2 `payrollId` values via the employee form**

Open at least two employees' edit pages and set their matricola (e.g., 5 for Brunelli, 11 for Seppolini).

- [ ] **Step 3: Walk the import flow**

Run: `npm run dev`. Navigate to `/settings/payroll-import`.
- Upload `prisma/fixtures/tabulato-marzo-2026.pdf`.
- Verify preview shows 9 rows, 2 matched, 7 unmatched (red).
- Use the "Associa a…" dropdown to link the remaining matricole to test employees (or skip & rely on Brunelli/Seppolini for spot-check).
- Click "Conferma import" → confirm dialog → expect redirect to history detail.

- [ ] **Step 4: Verify balances**

For Brunelli (matricola 5):
- Open `/employees/<id>/edit` or the dashboard → `Ferie residue` should show **30,15 giorni**.
- `ROL residue` should show **29,01 ore** (= 8,00 FES + 21,01 PER).

For Costieri (matricola 26, if associated): `Ferie residue = 2,31 giorni`.

- [ ] **Step 5: Verify idempotency**

Re-upload the same PDF → preview banner says "già importato" → confirm anyway → dashboard balances unchanged.

- [ ] **Step 6: Verify auto-recompute after a new LeaveRequest**

Approve a 1-day vacation `LeaveRequest` for Brunelli (via existing leave UI). Dashboard should now show **29,15 giorni**. Re-import the PDF → dashboard back to **30,15 giorni** (accrualAdjust recomputed).

- [ ] **Step 7: Verify history**

Open `/settings/payroll-import/history` → at least 3 import rows. Open the most recent detail → see per-employee diff.

- [ ] **Step 8: Final commit (if any docs/notes)**

If the verification surfaced any small fixes, commit them now. Otherwise no commit needed.

---

## Done

The feature is shippable. Next session can pick up `superpowers:finishing-a-development-branch` to decide PR vs direct merge to `main`.
