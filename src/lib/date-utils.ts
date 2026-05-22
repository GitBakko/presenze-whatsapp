/**
 * Utility condivise per date e orari.
 *
 * Centralizza le funzioni che erano copiate in 7+ file:
 *   - getDayOfWeek: da "YYYY-MM-DD" a 1=Lun..7=Dom (Europe/Rome anchored)
 *   - hmToMinutes: da "HH:MM" a minuti dal midnight
 *   - formatDateIt: da "YYYY-MM-DD" a "DD/MM/YYYY"
 *   - formatDateIsoIt: da ISO timestamp a "DD/MM/YYYY"
 *   - formatDateTimeIt: da ISO timestamp a "DD/MM/YYYY HH:MM"
 */

import { dowRome } from "./tz";

/**
 * Giorno della settimana 1=Lunedì..7=Domenica, coerente con
 * EmployeeSchedule.dayOfWeek (1=Mon..5=Fri). Anchored at Europe/Rome
 * noon to avoid DST drift if the host TZ ever changes from CET/CEST.
 */
export function getDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return dowRome(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
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

/**
 * ISO timestamp → "DD/MM/YYYY" (date only, Europe/Rome calendar).
 * For raw `YYYY-MM-DD` strings use `formatDateIt` (no TZ conversion needed).
 */
export function formatDateIsoIt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
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
