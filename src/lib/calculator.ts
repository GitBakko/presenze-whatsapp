import {
  WORK_SCHEDULE,
  DELAY_TOLERANCE_MINUTES,
} from "./constants";

import type { RecordType } from "./parser";

export interface DailyRecord {
  employeeId: string;
  employeeName: string;
  date: string;
  records: { type: RecordType; declaredTime: string; messageTime: string }[];
}

export interface EmployeeScheduleDay {
  block1Start: string | null;
  block1End: string | null;
  block2Start: string | null;
  block2End: string | null;
}

export interface PauseBlock {
  start: string;
  end: string;
  minutes: number;
}

export interface OvertimeBlock {
  start: string;
  end: string;
  minutes: number;
  explicit: boolean; // true = declared OVERTIME_START/END, false = auto (post-schedule)
}

export interface AnomalyItem {
  type: string;
  description: string;
}

export interface DailyStats {
  employeeId: string;
  employeeName: string;
  date: string;
  // Declared-time based
  hoursWorked: number;
  // Message-time based (for comparison)
  hoursWorkedMsg: number;
  pauseMinutes: number;
  pauses: PauseBlock[];
  morningDelay: number;
  afternoonDelay: number;
  overtime: number;
  overtimeBlocks: OvertimeBlock[];
  hasAnomaly: boolean;
  anomalies: AnomalyItem[];
  entries: string[];
  exits: string[];
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Calculate daily statistics for a single employee on a single day.
 * Handles: pauses (subtracted from hours), overtime (explicit + auto),
 * delays based on employee schedule, dual time tracking.
 */
export function calculateDailyStats(
  record: DailyRecord,
  schedule?: EmployeeScheduleDay | null
): DailyStats {
  const { records, employeeId, employeeName, date } = record;
  const anomalies: AnomalyItem[] = [];

  // Separate records by type
  const entries = records.filter((r) => r.type === "ENTRY").map((r) => r.declaredTime).sort();
  const exits = records.filter((r) => r.type === "EXIT").map((r) => r.declaredTime).sort();
  const pauseStarts = records.filter((r) => r.type === "PAUSE_START").map((r) => r.declaredTime).sort();
  const pauseEnds = records.filter((r) => r.type === "PAUSE_END").map((r) => r.declaredTime).sort();
  const overtimeStarts = records.filter((r) => r.type === "OVERTIME_START").map((r) => r.declaredTime).sort();
  const overtimeEnds = records.filter((r) => r.type === "OVERTIME_END").map((r) => r.declaredTime).sort();

  // Message-time versions for dual tracking
  const entriesMsg = records.filter((r) => r.type === "ENTRY").map((r) => r.messageTime).sort();
  const exitsMsg = records.filter((r) => r.type === "EXIT").map((r) => r.messageTime).sort();

  // --- Anomaly detection ---
  if (entries.length > 0 && exits.length === 0) {
    anomalies.push({ type: "MISSING_EXIT", description: "Entrata senza uscita" });
  }
  if (exits.length > 0 && entries.length === 0) {
    anomalies.push({ type: "MISSING_ENTRY", description: "Uscita senza entrata" });
  }
  if (entries.length > 0 && exits.length > 0 && entries.length !== exits.length) {
    anomalies.push({
      type: "MISMATCHED_PAIRS",
      description: `Entrate (${entries.length}) e uscite (${exits.length}) non corrispondono`,
    });
  }
  if (pauseStarts.length > 0 && pauseEnds.length === 0) {
    anomalies.push({ type: "PAUSE_NO_END", description: "Pausa iniziata senza fine" });
  }
  if (overtimeStarts.length > 0 && overtimeEnds.length === 0) {
    anomalies.push({ type: "OVERTIME_NO_END", description: "Straordinario iniziato senza fine" });
  }

  // --- Chronological overlap / sequence validation ---
  // Build a timeline of all events and check for impossible overlaps
  type TimelineEvent = { time: number; label: string; raw: string; order: number };
  const timeline: TimelineEvent[] = [];
  entries.forEach((t, i) => timeline.push({ time: timeToMinutes(t), label: `Entrata ${i + 1}`, raw: t, order: 0 }));
  exits.forEach((t, i) => timeline.push({ time: timeToMinutes(t), label: `Uscita ${i + 1}`, raw: t, order: 1 }));
  pauseStarts.forEach((t, i) => timeline.push({ time: timeToMinutes(t), label: `Inizio pausa ${i + 1}`, raw: t, order: 2 }));
  pauseEnds.forEach((t, i) => timeline.push({ time: timeToMinutes(t), label: `Fine pausa ${i + 1}`, raw: t, order: 3 }));
  overtimeStarts.forEach((t, i) => timeline.push({ time: timeToMinutes(t), label: `Inizio straordinario ${i + 1}`, raw: t, order: 4 }));
  overtimeEnds.forEach((t, i) => timeline.push({ time: timeToMinutes(t), label: `Fine straordinario ${i + 1}`, raw: t, order: 5 }));
  // Sort by time, then by natural order (entries before exits at same time)
  timeline.sort((a, b) => a.time - b.time || a.order - b.order);

  // Check paired entry/exit overlaps (exit before entry, or blocks overlap)
  for (let i = 0; i < Math.min(entries.length, exits.length); i++) {
    const entryMin = timeToMinutes(entries[i]);
    const exitMin = timeToMinutes(exits[i]);
    if (exitMin <= entryMin) {
      anomalies.push({
        type: "TIME_OVERLAP",
        description: `Uscita ${i + 1} (${exits[i]}) prima o uguale a Entrata ${i + 1} (${entries[i]})`,
      });
    }
  }

  // Check that work blocks don't overlap each other (exit[i] should be <= entry[i+1])
  for (let i = 0; i < Math.min(entries.length, exits.length) - 1; i++) {
    const exitMin = timeToMinutes(exits[i]);
    const nextEntryMin = timeToMinutes(entries[i + 1]);
    if (exitMin > nextEntryMin) {
      anomalies.push({
        type: "TIME_OVERLAP",
        description: `Uscita ${i + 1} (${exits[i]}) si sovrappone a Entrata ${i + 2} (${entries[i + 1]})`,
      });
    }
  }

  // Check that pauses fall within a work block.
  //
  // A pause is considered valid if it overlaps EITHER:
  //   (a) one of the registered ENTRY/EXIT pairs, OR
  //   (b) one of the contracted schedule blocks (block1 / block2) of the
  //       employee, with the same fallback to WORK_SCHEDULE used elsewhere.
  //
  // Case (b) is needed because employees often punch only one entry in the
  // morning and one exit in the afternoon (single big "work block" of records)
  // but actually take a pause during their scheduled afternoon block. Without
  // checking the schedule we'd raise a false positive every time.
  const pauseScheduleBlocks: { start: number; end: number }[] = [];
  const pauseSched = schedule || {
    block1Start: WORK_SCHEDULE.morning.start,
    block1End: WORK_SCHEDULE.morning.end,
    block2Start: WORK_SCHEDULE.afternoon.start,
    block2End: WORK_SCHEDULE.afternoon.end,
  };
  if (pauseSched.block1Start && pauseSched.block1End) {
    pauseScheduleBlocks.push({
      start: timeToMinutes(pauseSched.block1Start),
      end: timeToMinutes(pauseSched.block1End),
    });
  }
  if (pauseSched.block2Start && pauseSched.block2End) {
    pauseScheduleBlocks.push({
      start: timeToMinutes(pauseSched.block2Start),
      end: timeToMinutes(pauseSched.block2End),
    });
  }

  for (let p = 0; p < pauseStarts.length; p++) {
    const ps = timeToMinutes(pauseStarts[p]);
    const pe = pauseEnds[p] ? timeToMinutes(pauseEnds[p]) : null;

    // (a) inside a registered ENTRY/EXIT block
    let insideBlock = false;
    for (let i = 0; i < Math.min(entries.length, exits.length); i++) {
      const eIn = timeToMinutes(entries[i]);
      const eOut = timeToMinutes(exits[i]);
      if (ps >= eIn && ps <= eOut && (pe === null || pe <= eOut)) {
        insideBlock = true;
        break;
      }
    }

    // (b) inside one of the contracted schedule blocks
    if (!insideBlock) {
      for (const blk of pauseScheduleBlocks) {
        if (ps >= blk.start && ps <= blk.end && (pe === null || pe <= blk.end)) {
          insideBlock = true;
          break;
        }
      }
    }

    if (!insideBlock && entries.length > 0 && exits.length > 0) {
      anomalies.push({
        type: "TIME_OVERLAP",
        description: `Pausa ${p + 1} (${pauseStarts[p]}${pe !== null ? ` – ${pauseEnds[p]}` : ""}) fuori dall'orario di lavoro`,
      });
    }
    // Pause end before pause start
    if (pe !== null && pe <= ps) {
      anomalies.push({
        type: "TIME_OVERLAP",
        description: `Fine pausa ${p + 1} (${pauseEnds[p]}) prima di inizio pausa (${pauseStarts[p]})`,
      });
    }
  }

  // Check that each entry/exit time fits its expected schedule block
  const schedForCheck = schedule || {
    block1Start: WORK_SCHEDULE.morning.start,
    block1End: WORK_SCHEDULE.morning.end,
    block2Start: WORK_SCHEDULE.afternoon.start,
    block2End: WORK_SCHEDULE.afternoon.end,
  };
  if (entries.length >= 2 && exits.length >= 2 && schedForCheck.block1End && schedForCheck.block2Start) {
    const block1EndMin = timeToMinutes(schedForCheck.block1End);
    const block2StartMin = timeToMinutes(schedForCheck.block2Start);
    // Morning exit in afternoon territory
    if (timeToMinutes(exits[0]) > block2StartMin) {
      anomalies.push({
        type: "TIME_BLOCK_MISMATCH",
        description: `Uscita mattina (${exits[0]}) in orario pomeridiano — possibile errore`,
      });
    }
    // Afternoon entry in morning territory
    if (timeToMinutes(entries[1]) < block1EndMin) {
      anomalies.push({
        type: "TIME_BLOCK_MISMATCH",
        description: `Entrata pomeriggio (${entries[1]}) in orario mattutino — possibile errore`,
      });
    }
  }

  // --- Calculate hours worked (declared time) ---
  let totalMinutesWorked = 0;
  const pairs = Math.min(entries.length, exits.length);
  for (let i = 0; i < pairs; i++) {
    const entryMin = timeToMinutes(entries[i]);
    const exitMin = timeToMinutes(exits[i]);
    if (exitMin > entryMin) {
      totalMinutesWorked += exitMin - entryMin;
    }
  }

  // --- Calculate hours worked (message time) ---
  let totalMinutesWorkedMsg = 0;
  const pairsMsg = Math.min(entriesMsg.length, exitsMsg.length);
  for (let i = 0; i < pairsMsg; i++) {
    const entryMin = timeToMinutes(entriesMsg[i]);
    const exitMin = timeToMinutes(exitsMsg[i]);
    if (exitMin > entryMin) {
      totalMinutesWorkedMsg += exitMin - entryMin;
    }
  }

  // --- Calculate pauses ---
  const pauses: PauseBlock[] = [];
  let totalPauseMinutes = 0;
  const pausePairs = Math.min(pauseStarts.length, pauseEnds.length);
  for (let i = 0; i < pausePairs; i++) {
    const startMin = timeToMinutes(pauseStarts[i]);
    const endMin = timeToMinutes(pauseEnds[i]);
    if (endMin > startMin) {
      const minutes = endMin - startMin;
      totalPauseMinutes += minutes;
      pauses.push({ start: pauseStarts[i], end: pauseEnds[i], minutes });
    }
  }

  // Subtract pauses from hours worked
  totalMinutesWorked = Math.max(0, totalMinutesWorked - totalPauseMinutes);
  totalMinutesWorkedMsg = Math.max(0, totalMinutesWorkedMsg - totalPauseMinutes);

  const hoursWorked = Math.round((totalMinutesWorked / 60) * 100) / 100;
  const hoursWorkedMsg = Math.round((totalMinutesWorkedMsg / 60) * 100) / 100;

  // --- Use employee schedule or default ---
  const sched = schedule || {
    block1Start: WORK_SCHEDULE.morning.start,
    block1End: WORK_SCHEDULE.morning.end,
    block2Start: WORK_SCHEDULE.afternoon.start,
    block2End: WORK_SCHEDULE.afternoon.end,
  };

  // --- Calculate delays ---
  let morningDelay = 0;
  if (sched.block1Start && entries.length > 0) {
    const firstEntry = timeToMinutes(entries[0]);
    const scheduleStart = timeToMinutes(sched.block1Start);
    if (firstEntry > scheduleStart + DELAY_TOLERANCE_MINUTES) {
      morningDelay = firstEntry - scheduleStart;
    }
  }

  let afternoonDelay = 0;
  if (sched.block2Start) {
    const afternoonEntry = entries.find((e) => {
      const m = timeToMinutes(e);
      return m >= timeToMinutes("14:00") && m <= timeToMinutes("16:00");
    });
    if (afternoonEntry) {
      const entryMin = timeToMinutes(afternoonEntry);
      const scheduleStart = timeToMinutes(sched.block2Start);
      if (entryMin > scheduleStart + DELAY_TOLERANCE_MINUTES) {
        afternoonDelay = entryMin - scheduleStart;
      }
    }
  }

  // --- Calculate overtime ---
  const overtimeBlocks: OvertimeBlock[] = [];
  let totalOvertimeMinutes = 0;

  // Explicit overtime blocks (OVERTIME_START / OVERTIME_END) — informational
  const explicitPairs = Math.min(overtimeStarts.length, overtimeEnds.length);
  for (let i = 0; i < explicitPairs; i++) {
    const startMin = timeToMinutes(overtimeStarts[i]);
    const endMin = timeToMinutes(overtimeEnds[i]);
    if (endMin > startMin) {
      const minutes = endMin - startMin;
      overtimeBlocks.push({
        start: overtimeStarts[i],
        end: overtimeEnds[i],
        minutes,
        explicit: true,
      });
    }
  }

  // Calculate contracted minutes from schedule blocks
  let contractedMinutes = 0;
  if (sched.block1Start && sched.block1End) {
    contractedMinutes += timeToMinutes(sched.block1End) - timeToMinutes(sched.block1Start);
  }
  if (sched.block2Start && sched.block2End) {
    contractedMinutes += timeToMinutes(sched.block2End) - timeToMinutes(sched.block2Start);
  }

  // Overtime = minutes worked exceeding contracted hours
  if (contractedMinutes > 0 && totalMinutesWorked > contractedMinutes) {
    totalOvertimeMinutes = totalMinutesWorked - contractedMinutes;
  }

  const overtime = Math.round((totalOvertimeMinutes / 60) * 100) / 100;

  return {
    employeeId,
    employeeName,
    date,
    hoursWorked,
    hoursWorkedMsg,
    pauseMinutes: totalPauseMinutes,
    pauses,
    morningDelay,
    afternoonDelay,
    overtime,
    overtimeBlocks,
    hasAnomaly: anomalies.length > 0,
    anomalies,
    entries,
    exits,
  };
}

/**
 * Aggregate monthly stats for an employee.
 */
export function aggregateMonthlyStats(dailyStats: DailyStats[]) {
  const totalDays = dailyStats.length;
  const totalHours = dailyStats.reduce((sum, d) => sum + d.hoursWorked, 0);
  const totalDelays = dailyStats.filter(
    (d) => d.morningDelay > 0 || d.afternoonDelay > 0
  ).length;
  const totalOvertime = dailyStats.reduce((sum, d) => sum + d.overtime, 0);
  const totalPauseMinutes = dailyStats.reduce((sum, d) => sum + d.pauseMinutes, 0);
  const anomalies = dailyStats.filter((d) => d.hasAnomaly).length;
  const daysWithoutPause = dailyStats.filter((d) => d.pauses.length === 0).length;

  return {
    totalDays,
    totalHours: Math.round(totalHours * 100) / 100,
    averageHours: totalDays > 0 ? Math.round((totalHours / totalDays) * 100) / 100 : 0,
    totalDelays,
    totalOvertime: Math.round(totalOvertime * 100) / 100,
    totalPauseMinutes,
    anomalies,
    daysWithoutPause,
  };
}
