/**
 * Classificatore lato server per i tap del kiosk NFC e del bot Telegram.
 *
 * Decide quale tipo di AttendanceRecord generare in base a:
 *   - lo stato corrente del dipendente (derivato dall'ultimo record del giorno)
 *   - la zona oraria del tap rispetto allo `EmployeeSchedule` del giorno
 *
 * Tipi prodotti: ENTRY | EXIT | PAUSE_START | PAUSE_END.
 *
 * NON produce mai OVERTIME_START/OVERTIME_END: gli straordinari sono calcolati
 * automaticamente dal `calculator.ts` come `hoursWorked > contractedMinutes`,
 * quindi un EXIT alle 19:30 (oltre block2End=18:30) viene già conteggiato come
 * straordinario senza bisogno di marcature esplicite. I record OVERTIME_*
 * restano riservati al canale WhatsApp (smart-working).
 */

import { WORK_SCHEDULE } from "@/lib/constants";

export type KioskAction = "ENTRY" | "EXIT" | "PAUSE_START" | "PAUSE_END";

export type KioskState = "FUORI" | "AL_LAVORO" | "IN_PAUSA";

export type KioskZone =
  | "PRIMA_LAVORO"
  | "DENTRO_BLOCCO_1"
  | "USCITA_BLOCCO_1"
  | "PAUSA_PRANZO"
  | "DENTRO_BLOCCO_2"
  | "USCITA_BLOCCO_2"
  | "DOPO_LAVORO";

export interface ScheduleBlocks {
  block1Start: string | null;
  block1End: string | null;
  block2Start: string | null;
  block2End: string | null;
}

export interface LastRecordSummary {
  type: string; // ENTRY | EXIT | PAUSE_START | PAUSE_END | OVERTIME_START | OVERTIME_END
}

/**
 * Minuti di tolleranza prima della fine del blocco orario in cui un
 * tap viene interpretato come "uscita" e non come "inizio pausa".
 *
 * Esempio con block1End=13:00 e EXIT_TOLERANCE=15:
 *   12:44 → DENTRO_BLOCCO_1 → PAUSE_START (pausa vera)
 *   12:45 → USCITA_BLOCCO_1 → EXIT (sta andando a pranzo)
 *   13:00 → USCITA_BLOCCO_1 → EXIT
 *   13:01 → PAUSA_PRANZO    → EXIT
 *
 * Valore: 30 minuti. Con schedule 09:00-13:00 / 14:30-18:30 significa
 * che dalle 12:30 in poi il tap è EXIT (uscita pranzo) e dalle 18:00
 * in poi è EXIT (fine giornata).
 */
const EXIT_TOLERANCE_MINUTES = 30;

// ── Helpers HH:MM ────────────────────────────────────────────────────

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

function hmLt(a: string, b: string): boolean {
  return a < b;
}

/**
 * True se `now` è entro `tolerance` minuti PRIMA di `boundary` (incluso
 * il boundary stesso). Cioè: boundary - tolerance ≤ now ≤ boundary.
 */
function isNearEnd(now: string, boundary: string, toleranceMinutes: number): boolean {
  const nowMin = hmToMinutes(now);
  const boundaryMin = hmToMinutes(boundary);
  return nowMin >= boundaryMin - toleranceMinutes && nowMin <= boundaryMin;
}

/** Risolve i blocchi orari: usa lo schedule se valido, altrimenti i defaults globali. */
export function resolveSchedule(schedule: ScheduleBlocks | null | undefined): {
  block1Start: string;
  block1End: string;
  block2Start: string;
  block2End: string;
} {
  const s = schedule;
  const allValid =
    !!s && !!s.block1Start && !!s.block1End && !!s.block2Start && !!s.block2End;
  if (allValid) {
    return {
      block1Start: s!.block1Start as string,
      block1End: s!.block1End as string,
      block2Start: s!.block2Start as string,
      block2End: s!.block2End as string,
    };
  }
  return {
    block1Start: WORK_SCHEDULE.morning.start,
    block1End: WORK_SCHEDULE.morning.end,
    block2Start: WORK_SCHEDULE.afternoon.start,
    block2End: WORK_SCHEDULE.afternoon.end,
  };
}

/** Determina lo stato del dipendente dall'ultimo record del giorno. */
export function computeState(last: LastRecordSummary | null | undefined): KioskState {
  if (!last) return "FUORI";
  switch (last.type) {
    case "ENTRY":
    case "PAUSE_END":
    case "OVERTIME_START":
      return "AL_LAVORO";
    case "PAUSE_START":
      return "IN_PAUSA";
    case "EXIT":
    case "OVERTIME_END":
    default:
      return "FUORI";
  }
}

/**
 * Determina la zona oraria del tap rispetto allo schedule.
 *
 * Le zone USCITA_BLOCCO_1 e USCITA_BLOCCO_2 sono finestre di
 * EXIT_TOLERANCE_MINUTES prima della fine di ogni blocco lavorativo.
 * In queste zone un tap AL_LAVORO viene classificato come EXIT
 * (il dipendente sta uscendo a pranzo / fine giornata) e non come
 * PAUSE_START (sarebbe una pausa di 5-15 minuti a fine blocco,
 * insensata).
 *
 * Timeline con schedule 09:00-13:00 / 14:30-18:30 e tolerance 15min:
 *
 *   <09:00          → PRIMA_LAVORO
 *   09:00 – 12:44   → DENTRO_BLOCCO_1
 *   12:45 – 13:00   → USCITA_BLOCCO_1   ← finestra "sta uscendo"
 *   13:01 – 14:29   → PAUSA_PRANZO
 *   14:30 – 18:14   → DENTRO_BLOCCO_2
 *   18:15 – 18:30   → USCITA_BLOCCO_2   ← finestra "sta uscendo"
 *   >18:30          → DOPO_LAVORO
 */
export function computeZone(now: string, schedule: ScheduleBlocks | null | undefined): KioskZone {
  const r = resolveSchedule(schedule);

  if (hmLt(now, r.block1Start)) return "PRIMA_LAVORO";

  // Dentro il blocco 1 (09:00 – 13:00) con sottozona uscita
  if (hmToMinutes(now) <= hmToMinutes(r.block1End)) {
    if (isNearEnd(now, r.block1End, EXIT_TOLERANCE_MINUTES)) return "USCITA_BLOCCO_1";
    return "DENTRO_BLOCCO_1";
  }

  if (hmLt(now, r.block2Start)) return "PAUSA_PRANZO";

  // Dentro il blocco 2 (14:30 – 18:30) con sottozona uscita
  if (hmToMinutes(now) <= hmToMinutes(r.block2End)) {
    if (isNearEnd(now, r.block2End, EXIT_TOLERANCE_MINUTES)) return "USCITA_BLOCCO_2";
    return "DENTRO_BLOCCO_2";
  }

  return "DOPO_LAVORO";
}

/**
 * Decisione finale.
 *
 * Matrice:
 *   FUORI     + qualsiasi zona                             → ENTRY
 *   AL_LAVORO + DENTRO_BLOCCO_1                            → PAUSE_START
 *   AL_LAVORO + DENTRO_BLOCCO_2                            → PAUSE_START
 *   AL_LAVORO + USCITA_BLOCCO_1                            → EXIT  (sta uscendo a pranzo)
 *   AL_LAVORO + USCITA_BLOCCO_2                            → EXIT  (sta uscendo fine giornata)
 *   AL_LAVORO + (PRIMA|PAUSA_PRANZO|DOPO)                  → EXIT
 *   IN_PAUSA  + qualsiasi                                  → PAUSE_END
 */
export function classifyPunch(state: KioskState, zone: KioskZone): KioskAction {
  if (state === "FUORI") return "ENTRY";
  if (state === "IN_PAUSA") return "PAUSE_END";
  // state === AL_LAVORO
  if (zone === "DENTRO_BLOCCO_1" || zone === "DENTRO_BLOCCO_2") return "PAUSE_START";
  // Tutte le altre zone (incluse USCITA_BLOCCO_1/2, PAUSA_PRANZO, PRIMA, DOPO) → EXIT
  return "EXIT";
}

/** Helper unico: stato + zona → azione. */
export function decideAction(args: {
  last: LastRecordSummary | null | undefined;
  now: string;
  schedule: ScheduleBlocks | null | undefined;
}): KioskAction {
  const state = computeState(args.last);
  const zone = computeZone(args.now, args.schedule);
  return classifyPunch(state, zone);
}
