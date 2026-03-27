/**
 * Converts decimal hours to HH:MM format.
 * e.g. 8.5 → "8:30", 0.1 → "0:06", 7.75 → "7:45"
 */
export function hoursToHHMM(hours: number): string {
  const negative = hours < 0;
  const abs = Math.abs(hours);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  const time = `${h}:${String(m).padStart(2, "0")}`;
  return negative ? `-${time}` : time;
}

/**
 * Converts minutes to HH:MM format.
 * e.g. 90 → "1:30", 45 → "0:45", 5 → "0:05"
 */
export function minutesToHHMM(minutes: number): string {
  const negative = minutes < 0;
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const time = `${h}:${String(m).padStart(2, "0")}`;
  return negative ? `-${time}` : time;
}

/**
 * Formats a date string YYYY-MM-DD to DD/MM/YYYY.
 */
export function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}
