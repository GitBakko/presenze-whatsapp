/**
 * Helper timezone-aware per Europe/Rome.
 *
 * Il resto del codebase usa `new Date().toISOString().split("T")[0]` (UTC),
 * che vicino a mezzanotte locale può sfasare il giorno. Per il kiosk NFC,
 * dove la `date` di un AttendanceRecord deve corrispondere al giorno di
 * calendario italiano in cui l'utente ha effettivamente badgiato, usare
 * sempre questi helper.
 *
 * Implementazione zero-deps via Intl.DateTimeFormat (disponibile in Node ≥12).
 */

const TZ = "Europe/Rome";

function parts(date: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return out;
}

/** "YYYY-MM-DD" nel fuso Europe/Rome. */
export function todayRome(date: Date = new Date()): string {
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "HH:MM" nel fuso Europe/Rome. */
export function nowRomeHHMM(date: Date = new Date()): string {
  const p = parts(date);
  return `${p.hour}:${p.minute}`;
}

/**
 * Day of week in Europe/Rome, codifica del progetto:
 * 1 = lunedì … 7 = domenica.
 * (Coerente con `EmployeeSchedule.dayOfWeek` che usa 1=Mon … 5=Fri.)
 */
export function dowRome(date: Date = new Date()): number {
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return map[parts(date).weekday] ?? 1;
}
