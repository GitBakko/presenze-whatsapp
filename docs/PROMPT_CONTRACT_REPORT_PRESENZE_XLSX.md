# PROMPT CONTRACT — Report Presenze Mensile (formato foglio presenze)
**Versione:** 1.0  
**Target:** Claude Code (Opus 4.6)  
**Progetto:** `presenze-whatsapp` — Next.js 16 + Prisma + SQLite + SheetJS  
**Scope:** Nuovo endpoint API + pagina UI per generare un report mensile `.xlsx` nel formato "foglio presenze" (griglia dipendenti × giorni) identico al template `gennaio_2026.xlsx`  

---

## § 0 — REGOLE ASSOLUTE

1. **NON modificare `src/app/api/export/route.ts`.** L'export esistente (tabella piatta per consulente del lavoro) resta intatto. Questo è un **nuovo** endpoint dedicato.
2. **Stack esistente.** Il progetto usa `xlsx` (SheetJS) `^0.18.5` community edition. Questa versione NON supporta formattazione avanzata (bordi, font per cella, merge con stili). **È necessario aggiungere `exceljs` come dipendenza** per produrre il formato richiesto. È l'unica nuova dipendenza consentita.
3. **TypeScript strict.** Tipi espliciti, nessun `any`.
4. **Convenzioni progetto.** Segui lo stile di `src/app/api/export/route.ts` per auth guard (`checkAuth()`), query params, Prisma queries, response headers.
5. **Formato pixel-perfect.** Il file generato deve essere visivamente identico al template quando aperto in Excel/LibreOffice.

---

## § 1 — TEMPLATE DI RIFERIMENTO (gennaio_2026.xlsx)

### Layout del foglio

Il foglio (`Foglio1`) è una griglia mensile: **dipendenti sulle righe, giorni del mese sulle colonne**.

Ogni dipendente occupa **2 righe consecutive**:
- **Riga "O"** (Ordinario/ufficio): ore lavorate in sede
- **Riga "F/P"** (Fuori sede / Permesso): ore fuori sede, smart working, permesso

### Griglia colonne

| Colonna | Contenuto | Larghezza |
|---------|-----------|-----------|
| **A** | "COGNOME E NOME" (header) / Nome dipendente | 19.71 |
| **B** | `"O"` oppure `"F/P"` | 8.29 |
| **C → C+(N-1)** | Giorni 1..N del mese | ~2.71 ciascuna |
| **C+N** | `"buoni pasto"` | 10.86 |

Esempio gennaio (31 giorni): C=giorno 1, AG=giorno 31, AH=buoni pasto.

### Riga 1 — Titolo mese

```
A1: vuota (formattata: bordi thin, center, bold Calibri 9, wrapText, numfmt "@")
B1: vuota
C1: "<nome_mese_minuscolo> <anno>" (es. "gennaio 2026")
    Merge: da C1 alla colonna dell'ultimo giorno (es. C1:AG1 per 31 gg)
    NON includere la colonna "buoni pasto" nel merge
    Font: Calibri 9, bold, center, wrapText, bordi thin, numfmt "@"
```

### Riga 2 — Header giorni

```
A2: "COGNOME E NOME"  — Calibri 9, bold, theme color 1
    Bordi: left thin, top thin, bottom thin (NO right)
B2: vuota             — Calibri 9, bold, theme color 1
    Bordi: right thin, top thin, bottom thin (NO left)
C2..ultimo_giorno:    — Numeri interi 1, 2, 3, ..., N
    Calibri 9, bold, wrapText, bordi thin tutti i lati
Colonna buoni pasto:  — "buoni pasto" (testo)
    Calibri 11, normal (NON bold), theme color 1, NESSUN bordo
```

### Righe dati — Per ogni dipendente

#### Riga "O" (ordinario)

| Cella | Contenuto | Formattazione |
|-------|-----------|---------------|
| A | `"COGNOME NOME"` (maiuscolo) | Calibri 9, bold, theme color 1, bordo left thin |
| B | `"O"` | Calibri 9, bold, theme color 1, nessun bordo |
| Giorno lavorativo con ore in sede | Intero (`4`, `8`) | Calibri 9, bold, center, wrapText, bordi thin |
| Giorno lavorativo senza ore in sede | Cella vuota | Stessa formattazione bordi |
| Weekend / Festivo | Stringa `"-"` | Stessa formattazione |
| Buoni pasto | Intero (conteggio mese) | Calibri 9, bold, center, wrapText, bordi thin |

#### Riga "F/P" (fuori sede / permesso)

| Cella | Contenuto | Formattazione |
|-------|-----------|---------------|
| A | Vuota | — |
| B | `"F/P"` | Calibri 9, bold, theme color 1, bordo right thin, bordo **bottom MEDIUM** |
| Giorno con ore F/P | Intero (`4`, `8`) | Calibri 9, bold, center, wrapText, bordi: left/right/top thin, **bottom MEDIUM** |
| Giorno senza ore F/P | Vuota | Stessa formattazione bordi (bottom medium anche se vuota) |
| Buoni pasto | Vuota | — |

**CRITICO:** La riga F/P ha bordo inferiore `medium` (non thin) su **tutte** le celle dei giorni e su B. Questo è il separatore visivo tra dipendenti.

---

## § 2 — MAPPING DATI → CELLE

### Fonti dati (dal DB Prisma esistente)

1. **`AttendanceRecord`** — record giornalieri per il mese richiesto
2. **`calculateDailyStats()`** da `src/lib/calculator.ts` — produce `DailyStats` con `hoursWorked`
3. **`EmployeeSchedule`** — orari settimanali per `calculateDailyStats()`
4. **`LeaveRequest`** (status `"APPROVED"`) — ferie/permessi approvati
5. **`Employee`** — `displayName || name` per colonna A

La query e il raggruppamento per dipendente+giorno seguono esattamente lo stesso pattern di `src/app/api/export/route.ts` (righe 25–80).

### Logica ore per cella

Per ogni dipendente e ogni giorno del mese:

```
SE isNonWorkingDay(giorno):
  → Riga O: "-"  |  Riga F/P: vuota

SE ha LeaveRequest approvata full-day (VACATION, SICK, ecc.):
  → Riga O: vuota  |  Riga F/P: 8 (o ore dal leave)

SE ha LeaveRequest approvata half-day (VACATION_HALF_AM / VACATION_HALF_PM):
  → Distribuire: ore lavorate in O, ore leave in F/P

SE ha ore lavorate senza leave:
  → Riga O: Math.round(hoursWorked)  |  Riga F/P: vuota

SE hoursWorked = 0 e nessun leave:
  → Riga O: vuota  |  Riga F/P: vuota  (assenza)
```

### Buoni pasto

**Non presente nel DB.** Calcolo automatico:
```
buoniPasto = conteggio giorni del mese in cui hoursWorked >= 6
```

---

## § 3 — FESTIVITÀ ITALIANE

```typescript
// src/lib/holidays-it.ts

const FESTIVITA_FISSE: [number, number][] = [
  [1, 1],   // Capodanno
  [1, 6],   // Epifania
  [4, 25],  // Liberazione
  [5, 1],   // Festa del Lavoro
  [6, 2],   // Festa della Repubblica
  [8, 15],  // Ferragosto
  [11, 1],  // Tutti i Santi
  [12, 8],  // Immacolata
  [12, 25], // Natale
  [12, 26], // Santo Stefano
];

// + Pasqua (algoritmo di Gauss/Meeus) e Lunedì dell'Angelo

export function getItalianHolidays(year: number): Set<string>;
// Ritorna Set di stringhe "YYYY-MM-DD"

export function isNonWorkingDay(dateStr: string): boolean;
// true se weekend (Sab/Dom) o festività italiana
```

---

## § 4 — FILE DA CREARE / MODIFICARE

```
src/
├── app/
│   ├── api/
│   │   └── export/
│   │       ├── route.ts                  ← NON TOCCARE
│   │       └── presenze/
│   │           └── route.ts              ← NUOVO
│   └── (dashboard)/
│       └── reports/
│           └── page.tsx                  ← MODIFICA (aggiungere pulsante)
├── lib/
│   ├── excel-presenze.ts                 ← NUOVO
│   └── holidays-it.ts                    ← NUOVO
package.json                              ← MODIFICA (aggiungere exceljs)
```

### `src/lib/holidays-it.ts`

Exports: `getItalianHolidays(year)`, `isNonWorkingDay(dateStr)`

### `src/lib/excel-presenze.ts`

```typescript
export interface PresenzeMonthData {
  year: number;
  month: number; // 1-12
  employees: PresenzeEmployeeData[];
}

export interface PresenzeEmployeeData {
  displayName: string;        // "COGNOME NOME" maiuscolo
  days: Map<number, {         // giorno (1-31) → dati
    oreOrdinario: number | null;
    oreFuoriSede: number | null;
  }>;
  buoniPasto: number;
}

export async function generatePresenzeXlsx(data: PresenzeMonthData): Promise<Buffer>;
```

Implementazione con **ExcelJS**:

```typescript
import ExcelJS from "exceljs";

// Font riutilizzabili
const FONT_BASE: Partial<ExcelJS.Font> = { name: "Calibri", size: 9, bold: true };
const FONT_BUONI: Partial<ExcelJS.Font> = { name: "Calibri", size: 11, bold: false };

// Bordi
const THIN: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FF000000" } };
const MEDIUM: Partial<ExcelJS.Border> = { style: "medium", color: { argb: "FF000000" } };
const BORDERS_ALL_THIN = { top: THIN, bottom: THIN, left: THIN, right: THIN };
const BORDERS_FP = { top: THIN, bottom: MEDIUM, left: THIN, right: THIN };

// Alignment
const ALIGN_CENTER_WRAP: Partial<ExcelJS.Alignment> = { horizontal: "center", wrapText: true };
```

### `src/app/api/export/presenze/route.ts`

```typescript
// GET /api/export/presenze?month=2026-01
//
// 1. checkAuth()
// 2. Parse query param "month" (YYYY-MM)
// 3. Fetch Employee[], AttendanceRecord[], EmployeeSchedule[], LeaveRequest[]
// 4. Per ogni dipendente + giorno: calculateDailyStats(), split O/F/P, conta buoni pasto
// 5. Ordina dipendenti per cognome (A→Z)
// 6. generatePresenzeXlsx()
// 7. Return Response con:
//    Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
//    Content-Disposition: attachment; filename="presenze_gennaio_2026.xlsx"
```

### Modifica `src/app/(dashboard)/reports/page.tsx`

Aggiungere un pulsante "Foglio Presenze" accanto ai pulsanti CSV/XLSX esistenti.
Stessa classe CSS, icona `<Download />`. Chiama:

```typescript
window.open(`/api/export/presenze?month=${month}`, "_blank");
```

---

## § 5 — NOMI MESI ITALIANI

```typescript
const MESI_IT = [
  "", "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"
];
```

---

## § 6 — ORDINE DI ESECUZIONE

### Sprint 1 — Holidays + Excel generator
1. `npm install exceljs`
2. Creare `src/lib/holidays-it.ts`
3. Creare `src/lib/excel-presenze.ts` con formattazione completa
4. Test standalone: generare file per gennaio 2026 con dati mock, confrontare visivamente col template

**⏸ PAUSA — mostrami il file generato prima di procedere.**

### Sprint 2 — API endpoint + dati reali
1. Creare `src/app/api/export/presenze/route.ts`
2. Riusare pattern query da `export/route.ts` (records + schedules + dismissed anomalies)
3. Aggiungere query LeaveRequest per il mese
4. Mapping → `PresenzeMonthData`
5. Test end-to-end

**⏸ PAUSA — test con dati reali dal DB.**

### Sprint 3 — UI + rifinitura
1. Aggiungere pulsante "Foglio Presenze" in `reports/page.tsx`
2. Verificare `npm run build` senza errori
3. Test completo

---

## § 7 — CRITERI DI COMPLETAMENTO

- [ ] `GET /api/export/presenze?month=YYYY-MM` funzionante con auth
- [ ] File `.xlsx` visivamente identico al template `gennaio_2026.xlsx`
- [ ] Font: Calibri 9 bold ovunque, tranne "buoni pasto" header = Calibri 11 normal
- [ ] Bordi: thin su riga O, **bottom medium** su riga F/P (separatore dipendenti)
- [ ] Merge C1 fino all'ultimo giorno (esclusa colonna buoni pasto)
- [ ] Larghezze colonne: A=19.71, B=8.29, giorni≈2.71, buoni pasto=10.86
- [ ] Weekend + festività italiane → `"-"` in riga O, vuoto in F/P
- [ ] Pasqua e Lunedì dell'Angelo calcolati dinamicamente
- [ ] Dipendenti ordinati alfabeticamente per cognome
- [ ] Buoni pasto = giorni con ≥6h lavorate
- [ ] Pulsante "Foglio Presenze" nella pagina Reports (stile coerente)
- [ ] Endpoint esistente `/api/export` **NON modificato**
- [ ] `exceljs` unica nuova dipendenza
- [ ] `npm run build` passa senza errori TypeScript
