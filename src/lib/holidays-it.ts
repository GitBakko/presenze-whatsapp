/**
 * Festività italiane per il calcolo dei giorni non lavorativi nel
 * report presenze.
 *
 * Zero dipendenze. La Pasqua e' calcolata con l'algoritmo di Meeus
 * (Anonymous Gregorian algorithm) che funziona per qualsiasi anno
 * dell'era cristiana nel calendario gregoriano.
 */

/** Festività italiane fisse: [mese, giorno] */
const FESTIVITA_FISSE: ReadonlyArray<readonly [number, number]> = [
  [1, 1],   // Capodanno
  [1, 6],   // Epifania
  [4, 25],  // Festa della Liberazione
  [5, 1],   // Festa del Lavoro
  [6, 2],   // Festa della Repubblica
  [8, 15],  // Ferragosto
  [11, 1],  // Tutti i Santi
  [12, 8],  // Immacolata Concezione
  [12, 25], // Natale
  [12, 26], // Santo Stefano
];

/**
 * Calcola la data della Pasqua (Domenica) per un anno dato col
 * cosiddetto "Anonymous Gregorian Algorithm" attribuito a J.-M. Oudin
 * (1940) e pubblicato da Meeus in "Astronomical Algorithms".
 *
 * Restituisce { month: 1-12, day: 1-31 }.
 */
function computeEaster(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Formatta in "YYYY-MM-DD" con zero padding. */
function fmt(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Restituisce l'insieme delle date festive italiane di un anno,
 * ciascuna nel formato "YYYY-MM-DD". Include le fisse + Pasqua +
 * Lunedi' dell'Angelo (Pasquetta, giorno dopo la Pasqua).
 */
export function getItalianHolidays(year: number): Set<string> {
  const set = new Set<string>();
  for (const [m, d] of FESTIVITA_FISSE) {
    set.add(fmt(year, m, d));
  }
  const easter = computeEaster(year);
  const easterDate = new Date(Date.UTC(year, easter.month - 1, easter.day));
  set.add(fmt(year, easter.month, easter.day));
  // Lunedi' dell'Angelo (Pasquetta) = Pasqua + 1 giorno
  const monday = new Date(easterDate);
  monday.setUTCDate(monday.getUTCDate() + 1);
  set.add(
    fmt(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate())
  );
  return set;
}

/**
 * True se la data e' un giorno non lavorativo secondo il calendario
 * italiano standard: sabato, domenica o festivita' nazionale.
 *
 * `dateStr` deve essere nel formato "YYYY-MM-DD".
 */
export function isNonWorkingDay(dateStr: string): boolean {
  // Weekend
  const [y, m, d] = dateStr.split("-").map(Number);
  // new Date(y, m-1, d) usa il timezone locale, che e' corretto per
  // determinare il giorno della settimana di una data italiana.
  const jsDow = new Date(y, m - 1, d).getDay(); // 0 = Dom, 6 = Sab
  if (jsDow === 0 || jsDow === 6) return true;

  // Festivita'
  return getItalianHolidays(y).has(dateStr);
}
