/**
 * Utility condivise per date e orari.
 *
 * Centralizza le funzioni che erano copiate in 7+ file:
 *   - getDayOfWeek: da "YYYY-MM-DD" a 1=Lun..7=Dom
 *   - hmToMinutes: da "HH:MM" a minuti dal midnight
 *   - formatDateIt: da "YYYY-MM-DD" a "DD/MM/YYYY"
 *   - formatDateTimeIt: da ISO string a "DD/MM/YYYY HH:MM"
 */

/**
 * Giorno della settimana 1=Lunedì..7=Domenica, coerente con
 * EmployeeSchedule.dayOfWeek (1=Mon..5=Fri).
 */
export function getDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 ? 7 : day;
}

/** Converte "HH:MM" in minuti dal midnight. */
export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/** "YYYY-MM-DD" → "DD/MM/YYYY" */
export function formatDateIt(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

/** ISO string → "DD/MM/YYYY HH:MM" */
export function formatDateTimeIt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
