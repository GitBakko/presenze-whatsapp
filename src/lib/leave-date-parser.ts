/**
 * Parser condiviso per il formato data delle richieste ferie.
 *
 * Usato sia dal bot Telegram (`/ferie DAL ... AL ...`) sia dall'ingest
 * email (subject "ferie", body con DAL/AL).
 *
 * Formati accettati (case insensitive):
 *   - "DAL gg/mm[/aaaa] AL gg/mm[/aaaa]"
 *   - "DAL gg/mm[/aaaa] AL gg/mm[/aaaa]" anche su righe separate
 *   - "gg/mm[/aaaa] - gg/mm[/aaaa]"
 *   - "gg/mm[/aaaa]" (singolo giorno)
 *
 * Se l'anno e' omesso si assume l'anno corrente.
 *
 * Restituisce { startDate, endDate } in formato YYYY-MM-DD oppure null
 * se l'input non e' parsabile o le date non sono valide.
 */

export function parseLeaveDates(input: string): { startDate: string; endDate: string } | null {
  // Normalizza spazi e newline in spazi singoli
  const cleaned = input.trim().replace(/\s+/g, " ");
  if (!cleaned) return null;

  // Pattern 1: "DAL gg/mm[/aaaa] AL gg/mm[/aaaa]"
  const re1 = /dal\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+al\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i;
  const m1 = cleaned.match(re1);
  if (m1) {
    const start = buildDate(m1[1], m1[2], m1[3]);
    const end = buildDate(m1[4], m1[5], m1[6]);
    if (start && end) return { startDate: start, endDate: end };
  }

  // Pattern 2: "gg/mm[/aaaa] - gg/mm[/aaaa]" oppure "gg/mm[/aaaa] AL gg/mm[/aaaa]"
  const re2 = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*(?:-|al|→)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i;
  const m2 = cleaned.match(re2);
  if (m2) {
    const start = buildDate(m2[1], m2[2], m2[3]);
    const end = buildDate(m2[4], m2[5], m2[6]);
    if (start && end) return { startDate: start, endDate: end };
  }

  // Pattern 3: singolo giorno "gg/mm[/aaaa]" -> start == end
  const re3 = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/;
  const m3 = cleaned.match(re3);
  if (m3) {
    const d = buildDate(m3[1], m3[2], m3[3]);
    if (d) return { startDate: d, endDate: d };
  }

  return null;
}

function buildDate(dd: string, mm: string, yyyy?: string): string | null {
  const day = parseInt(dd, 10);
  const month = parseInt(mm, 10);
  let year: number;
  if (yyyy) {
    year = parseInt(yyyy, 10);
    if (year < 100) year += 2000;
  } else {
    year = new Date().getFullYear();
  }
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  // Valida che il giorno esista nel mese (es. 31/02 fallisce)
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatItDate(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-");
  return `${d}/${m}/${y}`;
}
