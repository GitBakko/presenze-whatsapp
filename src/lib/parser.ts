export type RecordType = "ENTRY" | "EXIT" | "PAUSE_START" | "PAUSE_END" | "OVERTIME_START" | "OVERTIME_END";

export interface ParsedMessage {
  messageTime: string; // HH:MM from WhatsApp timestamp
  date: string; // YYYY-MM-DD
  employeeName: string;
  type: RecordType;
  declaredTime: string; // HH:MM — declared by employee or fallback to messageTime
  rawMessage: string;
}

// Intermediate type used during two-pass resolution
type PendingType = RecordType | "FINE";

interface PendingRecord {
  messageTime: string;
  date: string;
  employeeName: string;
  type: PendingType;
  declaredTime: string;
  rawMessage: string;
}

interface PauseRefRecord {
  messageTime: string;
  date: string;
  employeeName: string;
  targetName: string; // lowercase first name, e.g. "vlad"
  rawMessage: string;
}

interface WhatsAppLine {
  msgTime: string;
  dateStr: string;
  employeeName: string;
  messageContent: string;
  rawLine: string;
}

/**
 * Parse a WhatsApp chat export (.txt) into structured attendance records.
 *
 * V2 features:
 * - Tracks pauses (PAUSE_START / PAUSE_END)
 * - Tracks overtime (OVERTIME_START / OVERTIME_END)
 * - "fine" resolved by context (state machine per employee/day)
 * - "Pausa come vlad" copies target's pause times
 * - "+N minuti / HH:MM-HH:MM" overtime blocks
 * - "Pausa HH:MM - HH:MM" complete pause blocks
 * - Filters excluded names
 * - Handles all V1 patterns (typos, time variants, multi-line)
 */
export function parseWhatsAppExport(
  text: string,
  excludedNames: string[] = []
): {
  records: ParsedMessage[];
  errors: string[];
} {
  const errors: string[] = [];
  const excludedLower = new Set(excludedNames.map((n) => n.toLowerCase()));

  const messages = splitIntoMessages(text);
  const pendingRecords: PendingRecord[] = [];
  const pauseRefs: PauseRefRecord[] = [];

  // === Pass 1: Parse all messages into pending records ===
  for (const msg of messages) {
    const parsed = parseMessageLine(msg.headerLine);
    if (!parsed) continue;

    const name = parsed.employeeName.trim();
    if (excludedLower.has(name.toLowerCase())) continue;

    const fullContent = [parsed.messageContent, ...msg.continuationLines]
      .join("\n")
      .trim()
      .replace(/\u200e/g, "")
      .replace(/<Questo messaggio è stato modificato>/g, "")
      .trim();

    const date = parseDate(parsed.dateStr);
    if (!date) {
      errors.push(`Data non valida: ${parsed.dateStr}`);
      continue;
    }

    const msgTime = normalizeTime(parsed.msgTime);

    // --- Full-content patterns (checked before line-by-line) ---

    // "Pausa come [name]"
    const pauseRefMatch = fullContent.match(/^pausa\s+come\s+(\w+)/i);
    if (pauseRefMatch) {
      pauseRefs.push({
        messageTime: msgTime,
        date,
        employeeName: name,
        targetName: pauseRefMatch[1].toLowerCase(),
        rawMessage: msg.headerLine,
      });
      continue;
    }

    // "Pausa HH:MM - HH:MM" (complete pause range on one line)
    const pauseRangeMatch = fullContent.match(
      /^pausa\s+(\d{1,2}[.:]\d{2})\s*-\s*(\d{1,2}[.:]\d{2})/i
    );
    if (pauseRangeMatch) {
      pendingRecords.push({
        messageTime: msgTime,
        date,
        employeeName: name,
        type: "PAUSE_START",
        declaredTime: normalizeTime(pauseRangeMatch[1]),
        rawMessage: msg.headerLine,
      });
      pendingRecords.push({
        messageTime: msgTime,
        date,
        employeeName: name,
        type: "PAUSE_END",
        declaredTime: normalizeTime(pauseRangeMatch[2]),
        rawMessage: msg.headerLine,
      });
      continue;
    }

    // "+N minuti" with time range → overtime block
    const hasPlus = /^\+\d+\s*minut/im.test(fullContent);
    const timeRangeMatch = fullContent.match(
      /(\d{1,2}[.:]\d{2})\s*-\s*(\d{1,2}[.:]\d{2})/
    );
    if (hasPlus && timeRangeMatch) {
      pendingRecords.push({
        messageTime: msgTime,
        date,
        employeeName: name,
        type: "OVERTIME_START",
        declaredTime: normalizeTime(timeRangeMatch[1]),
        rawMessage: msg.headerLine,
      });
      pendingRecords.push({
        messageTime: msgTime,
        date,
        employeeName: name,
        type: "OVERTIME_END",
        declaredTime: normalizeTime(timeRangeMatch[2]),
        rawMessage: msg.headerLine,
      });
      continue;
    }

    // --- Line-by-line processing ---
    const contentLines = fullContent.split("\n");
    for (const contentLine of contentLines) {
      const trimmed = contentLine.trim();
      if (!trimmed) continue;

      const classified = classifyLine(trimmed, msgTime);
      if (!classified) continue;

      for (const rec of classified) {
        pendingRecords.push({
          messageTime: msgTime,
          date,
          employeeName: name,
          type: rec.type,
          declaredTime: rec.declaredTime,
          rawMessage: msg.headerLine,
        });
      }
    }
  }

  // === Pass 2: Resolve "FINE" using state machine per employee/day ===
  const grouped = new Map<string, PendingRecord[]>();
  for (const rec of pendingRecords) {
    const key = `${rec.employeeName}|${rec.date}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(rec);
  }

  const resolvedRecords: ParsedMessage[] = [];

  for (const [, dayRecords] of grouped) {
    let lastOpenState: "PAUSE" | "OVERTIME" | null = null;

    for (const rec of dayRecords) {
      if (rec.type === "PAUSE_START") {
        lastOpenState = "PAUSE";
      } else if (rec.type === "OVERTIME_START") {
        lastOpenState = "OVERTIME";
      } else if (rec.type === "PAUSE_END" || rec.type === "OVERTIME_END") {
        lastOpenState = null;
      }

      if (rec.type === "FINE") {
        if (lastOpenState === "PAUSE") {
          resolvedRecords.push({
            messageTime: rec.messageTime,
            date: rec.date,
            employeeName: rec.employeeName,
            type: "PAUSE_END",
            declaredTime: rec.declaredTime,
            rawMessage: rec.rawMessage,
          });
          lastOpenState = null;
        } else if (lastOpenState === "OVERTIME") {
          resolvedRecords.push({
            messageTime: rec.messageTime,
            date: rec.date,
            employeeName: rec.employeeName,
            type: "OVERTIME_END",
            declaredTime: rec.declaredTime,
            rawMessage: rec.rawMessage,
          });
          lastOpenState = null;
        } else {
          errors.push(
            `"fine" senza stato aperto per ${rec.employeeName} il ${rec.date}`
          );
        }
      } else {
        resolvedRecords.push({
          messageTime: rec.messageTime,
          date: rec.date,
          employeeName: rec.employeeName,
          type: rec.type as RecordType,
          declaredTime: rec.declaredTime,
          rawMessage: rec.rawMessage,
        });
      }
    }
  }

  // === Pass 3: Resolve "Pausa come [name]" ===
  for (const ref of pauseRefs) {
    const targetRecords = resolvedRecords.filter(
      (r) =>
        r.date === ref.date &&
        r.employeeName.toLowerCase().includes(ref.targetName) &&
        (r.type === "PAUSE_START" || r.type === "PAUSE_END")
    );

    const starts = targetRecords.filter((r) => r.type === "PAUSE_START");
    const ends = targetRecords.filter((r) => r.type === "PAUSE_END");

    if (starts.length > 0 && ends.length > 0) {
      for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
        resolvedRecords.push({
          messageTime: ref.messageTime,
          date: ref.date,
          employeeName: ref.employeeName,
          type: "PAUSE_START",
          declaredTime: starts[i].declaredTime,
          rawMessage: ref.rawMessage,
        });
        resolvedRecords.push({
          messageTime: ref.messageTime,
          date: ref.date,
          employeeName: ref.employeeName,
          type: "PAUSE_END",
          declaredTime: ends[i].declaredTime,
          rawMessage: ref.rawMessage,
        });
      }
    } else {
      errors.push(
        `Impossibile risolvere "pausa come ${ref.targetName}" per ${ref.employeeName} il ${ref.date}`
      );
    }
  }

  return { records: resolvedRecords, errors };
}

/**
 * Classify a single line of message content into attendance record(s).
 */
function classifyLine(
  content: string,
  msgTime: string
): { type: PendingType; declaredTime: string }[] | null {
  const cleaned = content.trim();

  // Skip known non-attendance messages
  if (isSkippable(cleaned)) return null;

  // "." → ENTRY
  if (cleaned === ".") {
    return [{ type: "ENTRY", declaredTime: msgTime }];
  }

  // Normalize common typos
  const normalized = cleaned
    .replace(/entrara/gi, "entrata")
    .replace(/uscira/gi, "uscita")
    .replace(/usciata/gi, "uscita")
    .replace(/uscìta/gi, "uscita");

  // --- PAUSE END patterns (check before generic "fine") ---

  // "fine pausa [alle] [time]"
  const finePausaMatch = normalized.match(
    /^fine\s+pausa(?:\s+alle?)?\s*(\d{1,2}[.:]\d{2})?\s*$/i
  );
  if (finePausaMatch) {
    const time = finePausaMatch[1]
      ? normalizeTime(finePausaMatch[1])
      : msgTime;
    return [{ type: "PAUSE_END", declaredTime: time }];
  }

  // --- PAUSE START patterns ---

  // "inizio pausa" / "pausa" [time]
  const pausaStartMatch = normalized.match(
    /^(?:inizio\s+)?pausa\s*(\d{1,2}[.:]\d{2})?\s*$/i
  );
  if (pausaStartMatch) {
    const time = pausaStartMatch[1]
      ? normalizeTime(pausaStartMatch[1])
      : msgTime;
    return [{ type: "PAUSE_START", declaredTime: time }];
  }

  // --- OVERTIME END patterns (check before generic "fine") ---

  // "fine straordinario/straordinari [time]"
  const fineOvertimeMatch = normalized.match(
    /^fine\s+straordinari[oi]?\s*(\d{1,2}[.:]\d{2})?\s*$/i
  );
  if (fineOvertimeMatch) {
    const time = fineOvertimeMatch[1]
      ? normalizeTime(fineOvertimeMatch[1])
      : msgTime;
    return [{ type: "OVERTIME_END", declaredTime: time }];
  }

  // "fine ore HH:MM"
  const fineOreMatch = normalized.match(
    /^fine\s+ore\s+(\d{1,2}[.:]\d{2})\s*$/i
  );
  if (fineOreMatch) {
    return [{ type: "OVERTIME_END", declaredTime: normalizeTime(fineOreMatch[1]) }];
  }

  // --- OVERTIME START patterns ---

  // "inizio straordinario/straordinari [time]"
  const inizioOvertimeMatch = normalized.match(
    /^inizio\s+straordinari[oi]?\s*(\d{1,2}[.:]\d{2})?\s*$/i
  );
  if (inizioOvertimeMatch) {
    const time = inizioOvertimeMatch[1]
      ? normalizeTime(inizioOvertimeMatch[1])
      : msgTime;
    return [{ type: "OVERTIME_START", declaredTime: time }];
  }

  // --- GENERIC "fine" (context-dependent, resolved in Pass 2) ---

  // "fine [time]" (no qualifier)
  const fineTimeMatch = normalized.match(
    /^fine\s+(\d{1,2}[.:]\d{2})\s*$/i
  );
  if (fineTimeMatch) {
    return [{ type: "FINE", declaredTime: normalizeTime(fineTimeMatch[1]) }];
  }

  // "fine" alone
  if (/^fine\s*$/i.test(normalized)) {
    return [{ type: "FINE", declaredTime: msgTime }];
  }

  // --- ENTRY / EXIT patterns ---

  // "HH:MM entrata/uscita" (time before keyword)
  const timeFirstMatch = normalized.match(
    /^(\d{1,2}[.:]\d{2})\s+(entrata|uscita)\s*$/i
  );
  if (timeFirstMatch) {
    const type =
      timeFirstMatch[2].toLowerCase() === "entrata" ? "ENTRY" : "EXIT";
    return [{ type, declaredTime: normalizeTime(timeFirstMatch[1]) }];
  }

  // "Entrata/Uscita [qualifier] [ore|alle] [time]"
  const entryExitMatch = normalized.match(
    /^(entrata|uscita)(?:\s+(?:pranzo|pomeriggio|mattina))?\s*(?:(?:ore|alle?)\s+)?(\d{1,2}[.:]\d{2})?\s*$/i
  );
  if (entryExitMatch) {
    const type =
      entryExitMatch[1].toLowerCase() === "entrata" ? "ENTRY" : "EXIT";
    const time = entryExitMatch[2]
      ? normalizeTime(entryExitMatch[2])
      : msgTime;
    return [{ type, declaredTime: time }];
  }

  // "Entrata/Uscita [qualifier] [ore|alle] [hour-only]"
  const hourOnlyMatch = normalized.match(
    /^(entrata|uscita)(?:\s+(?:pranzo|pomeriggio|mattina))?\s+(?:(?:ore|alle?)\s+)?(\d{1,2})\s*$/i
  );
  if (hourOnlyMatch) {
    const type =
      hourOnlyMatch[1].toLowerCase() === "entrata" ? "ENTRY" : "EXIT";
    return [{ type, declaredTime: normalizeTime(hourOnlyMatch[2]) }];
  }

  // Unrecognized message → skip
  return null;
}

/**
 * Check if a message should be skipped entirely.
 */
function isSkippable(content: string): boolean {
  const lower = content.toLowerCase();
  if (content.startsWith("\u200e")) return true;
  if (/^buongiorno/i.test(lower)) return true;
  if (/^arrivo/i.test(lower)) return true;
  if (/^l'uscita/i.test(lower)) return true;
  if (/^\+\d+\s*minut/i.test(lower)) return true;
  // Standalone time range (handled at full-content level)
  if (/^\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2}/.test(lower)) return true;
  return false;
}

/**
 * Split raw text into message blocks. A new message starts with [DD/MM/YY, ...].
 * Continuation lines (without the bracket prefix) belong to the previous message.
 */
function splitIntoMessages(text: string): { headerLine: string; continuationLines: string[] }[] {
  const messages: { headerLine: string; continuationLines: string[] }[] = [];
  const lines = text.split("\n");

  // Match start of a WhatsApp message line
  const headerRegex = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (headerRegex.test(trimmed)) {
      messages.push({ headerLine: trimmed, continuationLines: [] });
    } else if (messages.length > 0) {
      messages[messages.length - 1].continuationLines.push(trimmed);
    }
  }

  return messages;
}

/**
 * Parse a WhatsApp header line into its components.
 * Supports both [DD/MM/YY, HH:MM:SS] and [HH:MM, DD/MM/YYYY] formats.
 */
function parseMessageLine(line: string): WhatsAppLine | null {
  // Format 1: [DD/MM/YY, HH:MM:SS] Name: Message (real WhatsApp export)
  const format1 = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+?):\s*(.+)$/;
  // Format 2: [HH:MM, DD/MM/YYYY] Name: Message (alternative format)
  const format2 = /^\[(\d{1,2}:\d{2}),\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\]\s*(.+?):\s*(.+)$/;

  let match = line.match(format1);
  if (match) {
    return {
      dateStr: match[1],
      msgTime: match[2],
      employeeName: match[3],
      messageContent: match[4],
      rawLine: line,
    };
  }

  match = line.match(format2);
  if (match) {
    return {
      msgTime: match[1],
      dateStr: match[2],
      employeeName: match[3],
      messageContent: match[4],
      rawLine: line,
    };
  }

  return null;
}

/**
 * Parse date from DD/MM/YY or DD/MM/YYYY to YYYY-MM-DD.
 */
function parseDate(dateStr: string): string | null {
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;

  const day = parts[0].padStart(2, "0");
  const month = parts[1].padStart(2, "0");
  let year = parts[2];

  // Handle 2-digit year
  if (year.length === 2) {
    const yearNum = parseInt(year, 10);
    year = yearNum >= 70 ? `19${year}` : `20${year}`;
  }

  return `${year}-${month}-${day}`;
}

/**
 * Normalize a time string to HH:MM format.
 * "9" → "09:00", "09" → "09:00", "9:30" → "09:30", "18:40" → "18:40"
 * "9.06" → "09:06", "15.10" → "15:10"
 * "08:51:32" → "08:51" (strip seconds)
 */
function normalizeTime(time: string): string {
  const trimmed = time.trim();

  // Handle HH:MM:SS — strip seconds
  const withSeconds = trimmed.match(/^(\d{1,2}):(\d{2}):\d{2}$/);
  if (withSeconds) {
    return `${withSeconds[1].padStart(2, "0")}:${withSeconds[2]}`;
  }

  // Handle dot separator: 9.06, 15.10
  if (trimmed.includes(".")) {
    const [h, m] = trimmed.split(".");
    return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
  }

  if (trimmed.includes(":")) {
    const [h, m] = trimmed.split(":");
    return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
  }

  return `${trimmed.padStart(2, "0")}:00`;
}
