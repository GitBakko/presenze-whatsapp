/**
 * Classificatore lato server per i tap del kiosk NFC.
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
  | "PAUSA_PRANZO"
  | "DENTRO_BLOCCO_2"
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

/** Confronta due "HH:MM". */
function hmLte(a: string, b: string): boolean {
  return a <= b; // funziona perché formato fisso HH:MM con zero padding
}
function hmLt(a: string, b: string): boolean {
  return a < b;
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

/** Determina la zona oraria del tap rispetto allo schedule. */
export function computeZone(now: string, schedule: ScheduleBlocks | null | undefined): KioskZone {
  const r = resolveSchedule(schedule);
  if (hmLt(now, r.block1Start)) return "PRIMA_LAVORO";
  if (hmLte(now, r.block1End)) return "DENTRO_BLOCCO_1";
  if (hmLt(now, r.block2Start)) return "PAUSA_PRANZO";
  if (hmLte(now, r.block2End)) return "DENTRO_BLOCCO_2";
  return "DOPO_LAVORO";
}

/**
 * Decisione finale.
 *
 * Matrice:
 *   FUORI    + qualsiasi zona              → ENTRY
 *   AL_LAVORO + DENTRO_BLOCCO_1            → PAUSE_START  ("tap dentro orario = pausa")
 *   AL_LAVORO + DENTRO_BLOCCO_2            → PAUSE_START
 *   AL_LAVORO + (PRIMA|PAUSA_PRANZO|DOPO)  → EXIT
 *   IN_PAUSA  + qualsiasi                  → PAUSE_END
 */
export function classifyPunch(state: KioskState, zone: KioskZone): KioskAction {
  if (state === "FUORI") return "ENTRY";
  if (state === "IN_PAUSA") return "PAUSE_END";
  // state === AL_LAVORO
  if (zone === "DENTRO_BLOCCO_1" || zone === "DENTRO_BLOCCO_2") return "PAUSE_START";
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
