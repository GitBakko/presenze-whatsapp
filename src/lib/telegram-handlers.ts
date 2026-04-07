/**
 * Dispatcher e handler dei comandi del bot Telegram ep-bot.
 *
 * Comandi supportati (con scorciatoie):
 *   /start, /help
 *   /entrata    | /e   | tasto "Entrata"
 *   /uscita     | /u   | tasto "Uscita"
 *   /pausa      | /ip  | tasto "Inizio pausa"
 *   /finepausa  | /fp  | tasto "Fine pausa"
 *   /stato      | /s
 *   /storico
 *   /ferie DAL gg/mm[/aaaa] AL gg/mm[/aaaa]   |   /f ...
 *   /permesso ... (alias di /ferie per ora; v1 mappa entrambi a VACATION
 *                  in attesa di una semantica piu' raffinata)
 *
 * Tutta la logica e' server-side. Ogni handler riceve il context con
 * l'employee gia' risolto dal chat_id, lo stato e' verificato dal
 * classifier (riuso quello del kiosk), il debounce e' lo stesso (10s).
 */

import { prisma } from "./db";
import { Prisma } from "@prisma/client";
import { todayRome, nowRomeHHMM, dowRome } from "./tz";
import { decideAction, type KioskAction } from "./kiosk-classifier";
import { calculateDailyStats, type DailyRecord, type EmployeeScheduleDay } from "./calculator";
import { syncAnomalies } from "./anomaly-sync";
import { notificationsBus, type NotificationAction } from "./notifications-bus";
import { getTelegramBot, type TelegramMessage, type TelegramUpdate } from "./telegram-bot";
import { PUNCH_KEYBOARD, BUTTON_ENTRY, BUTTON_EXIT, BUTTON_PAUSE_START, BUTTON_PAUSE_END } from "./telegram-keyboards";
import { parseLeaveDates, formatItDate } from "./leave-date-parser";

const DEBOUNCE_SECONDS = 10;

// ── Tipi locali ──────────────────────────────────────────────────────

type EmployeeRow = NonNullable<Awaited<ReturnType<typeof prisma.employee.findUnique>>>;

interface CommandContext {
  message: TelegramMessage;
  chatId: string;
  employee: EmployeeRow;
}

type CommandHandler = (ctx: CommandContext, args: string) => Promise<void>;

// ── Helper di reply ──────────────────────────────────────────────────

async function reply(chatId: string, text: string, withKeyboard = true) {
  const bot = getTelegramBot();
  if (!bot) return;
  try {
    await bot.sendMessage({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...(withKeyboard ? { reply_markup: PUNCH_KEYBOARD } : {}),
    });
  } catch (err) {
    console.error("[telegram] reply failed:", err);
  }
}

// ── Risoluzione employee + log chat sconosciuti ──────────────────────

async function resolveEmployee(message: TelegramMessage) {
  const chat = message.chat;
  const chatIdStr = String(chat.id);

  const employee = await prisma.employee.findUnique({
    where: { telegramChatId: chatIdStr },
  });

  if (employee) return employee;

  // Upsert nella lista dei chat non riconosciuti per review admin
  try {
    await prisma.unrecognizedTelegramChat.upsert({
      where: { chatId: chatIdStr },
      create: {
        chatId: chatIdStr,
        username: chat.username ?? message.from?.username ?? null,
        firstName: chat.first_name ?? message.from?.first_name ?? null,
        lastName: chat.last_name ?? message.from?.last_name ?? null,
      },
      update: {
        lastSeenAt: new Date(),
        attempts: { increment: 1 },
        username: chat.username ?? message.from?.username ?? undefined,
        firstName: chat.first_name ?? message.from?.first_name ?? undefined,
        lastName: chat.last_name ?? message.from?.last_name ?? undefined,
      },
    });
  } catch (err) {
    console.error("[telegram] upsert unrecognized failed:", err);
  }

  return null;
}

// ── Comando: /start, /help ───────────────────────────────────────────

const START_TEXT = `👋 Ciao! Sono <b>ep-bot</b>, il bot per le presenze HR.

Usa i pulsanti qui sotto per timbrare entrata, uscita o pausa.

<b>Comandi disponibili:</b>
/entrata (o /e) — registra entrata
/uscita (o /u) — registra uscita
/pausa (o /ip) — inizio pausa
/finepausa (o /fp) — fine pausa
/stato (o /s) — stato corrente + ore di oggi
/storico — ultimi eventi del giorno
/ferie (o /f) <code>DAL 15/04 AL 18/04</code> — richiesta ferie
/permesso (o /p) <code>DAL 15/04 AL 18/04</code> — richiesta permesso
/help — questo messaggio`;

const handleStart: CommandHandler = async (ctx) => {
  await reply(ctx.chatId, `${START_TEXT}\n\nSei collegato come <b>${escapeHtml(ctx.employee.displayName || ctx.employee.name)}</b>.`);
};

// ── Punch handlers ───────────────────────────────────────────────────

async function doPunch(ctx: CommandContext, action: KioskAction): Promise<void> {
  const employee = ctx.employee;
  const now = new Date();
  const date = todayRome(now);
  const declaredTime = nowRomeHHMM(now);

  // 1. Debounce server (stesso del kiosk)
  const debounceCutoff = new Date(now.getTime() - DEBOUNCE_SECONDS * 1000);
  const recent = await prisma.attendanceRecord.findFirst({
    where: { employeeId: employee.id, date, createdAt: { gt: debounceCutoff } },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    await reply(ctx.chatId, `⏱ Tap troppo ravvicinato. Aspetta qualche secondo e riprova.`);
    return;
  }

  // 2. Inserisci il record
  let recordId: string;
  try {
    const created = await prisma.attendanceRecord.create({
      data: {
        employeeId: employee.id,
        date,
        type: action,
        declaredTime,
        messageTime: declaredTime,
        rawMessage: `[Telegram] ${action} da chat ${ctx.chatId}`,
        source: "MANUAL",
        isManual: false,
      },
    });
    recordId = created.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      await reply(ctx.chatId, `⚠️ Hai gia' una registrazione di questo tipo per le ${declaredTime}.`);
      return;
    }
    console.error("[telegram] punch failed:", e);
    await reply(ctx.chatId, `❌ Errore interno. Riprova tra qualche secondo.`);
    return;
  }

  // 3. Ricalcola anomalie + notifica admin in tempo reale
  try {
    await recalcAnomaliesForDay(employee, date);
  } catch (err) {
    console.error("[telegram] syncAnomalies failed:", err);
  }
  try {
    notificationsBus.publish({
      employeeId: employee.id,
      employeeName: employee.displayName || employee.name,
      action: action as NotificationAction,
      time: declaredTime,
      date,
    });
  } catch (err) {
    console.error("[telegram] notificationsBus.publish failed:", err);
  }

  // 4. Conferma all'utente
  const label = ACTION_LABELS_TG[action];
  await reply(ctx.chatId, `✅ ${label} registrata alle <b>${declaredTime}</b>.`);
  void recordId;
}

const ACTION_LABELS_TG: Record<KioskAction, string> = {
  ENTRY: "Entrata",
  EXIT: "Uscita",
  PAUSE_START: "Inizio pausa",
  PAUSE_END: "Fine pausa",
};

const handleEntry: CommandHandler = (ctx) => doPunch(ctx, "ENTRY");
const handleExit: CommandHandler = (ctx) => doPunch(ctx, "EXIT");
const handlePauseStart: CommandHandler = (ctx) => doPunch(ctx, "PAUSE_START");
const handlePauseEnd: CommandHandler = (ctx) => doPunch(ctx, "PAUSE_END");

// ── Stato e storico ──────────────────────────────────────────────────

const handleStato: CommandHandler = async (ctx) => {
  const date = todayRome();
  const records = await prisma.attendanceRecord.findMany({
    where: { employeeId: ctx.employee.id, date },
    orderBy: { declaredTime: "asc" },
  });

  if (records.length === 0) {
    await reply(ctx.chatId, `Nessuna timbratura per oggi. Buona giornata! 👋`);
    return;
  }

  // Riusa il classifier per dedurre lo stato attuale
  const lastRecord = records[records.length - 1];
  const dayOfWeek = dowRome();
  const schedule = await prisma.employeeSchedule.findUnique({
    where: { employeeId_dayOfWeek: { employeeId: ctx.employee.id, dayOfWeek } },
  });
  const nextAction = decideAction({
    last: { type: lastRecord.type },
    now: nowRomeHHMM(),
    schedule,
  });

  // Calcola ore lavorate oggi tramite il calculator
  const dr: DailyRecord = {
    employeeId: ctx.employee.id,
    employeeName: ctx.employee.displayName || ctx.employee.name,
    date,
    records: records.map((r) => ({
      type: r.type as DailyRecord["records"][0]["type"],
      declaredTime: r.declaredTime,
      messageTime: r.messageTime,
    })),
  };
  const empSchedDay: EmployeeScheduleDay | null = schedule
    ? {
        block1Start: schedule.block1Start,
        block1End: schedule.block1End,
        block2Start: schedule.block2Start,
        block2End: schedule.block2End,
      }
    : null;
  const stats = calculateDailyStats(dr, empSchedDay);

  const statoLabel: Record<KioskAction, string> = {
    ENTRY: "Sei <b>fuori</b>. Prossima timbratura prevista: <b>Entrata</b>.",
    EXIT: "Sei <b>al lavoro</b>. Prossima timbratura prevista: <b>Uscita</b>.",
    PAUSE_START: "Sei <b>al lavoro</b>. Prossima timbratura prevista: <b>Inizio pausa</b>.",
    PAUSE_END: "Sei <b>in pausa</b>. Prossima timbratura prevista: <b>Fine pausa</b>.",
  };

  const lines = [
    statoLabel[nextAction],
    "",
    `Ore lavorate oggi: <b>${stats.hoursWorked.toFixed(2)}h</b>`,
    `Pause: <b>${stats.pauseMinutes} min</b>`,
  ];
  if (stats.overtime > 0) lines.push(`Straordinario: <b>${stats.overtime.toFixed(2)}h</b>`);
  await reply(ctx.chatId, lines.join("\n"));
};

const handleStorico: CommandHandler = async (ctx) => {
  const date = todayRome();
  const records = await prisma.attendanceRecord.findMany({
    where: { employeeId: ctx.employee.id, date },
    orderBy: { declaredTime: "asc" },
    take: 20,
  });

  if (records.length === 0) {
    await reply(ctx.chatId, `Nessuna timbratura per oggi.`);
    return;
  }

  const lines = [`<b>Timbrature di oggi</b>`, ""];
  for (const r of records) {
    lines.push(`${r.declaredTime} — ${labelForType(r.type)}`);
  }
  await reply(ctx.chatId, lines.join("\n"));
};

function labelForType(t: string): string {
  switch (t) {
    case "ENTRY": return "🟢 Entrata";
    case "EXIT": return "🔴 Uscita";
    case "PAUSE_START": return "⏸ Inizio pausa";
    case "PAUSE_END": return "▶️ Fine pausa";
    case "OVERTIME_START": return "⏰ Inizio straordinario";
    case "OVERTIME_END": return "⏰ Fine straordinario";
    default: return t;
  }
}

// ── Ferie / permesso ─────────────────────────────────────────────────

const FERIE_HELP = `<b>Formato richiesta ferie:</b>
<code>/ferie DAL 15/04 AL 18/04</code>
oppure con anno esplicito:
<code>/ferie DAL 15/04/2026 AL 18/04/2026</code>
oppure singolo giorno:
<code>/ferie 15/04</code>`;

const handleFerie: CommandHandler = async (ctx, args) => {
  const parsed = parseLeaveDates(args);
  if (!parsed) {
    await reply(ctx.chatId, `❌ Formato non riconosciuto.\n\n${FERIE_HELP}`);
    return;
  }
  const { startDate, endDate } = parsed;
  if (startDate > endDate) {
    await reply(ctx.chatId, `❌ La data di fine deve essere maggiore o uguale a quella di inizio.`);
    return;
  }

  try {
    const leave = await prisma.leaveRequest.create({
      data: {
        employeeId: ctx.employee.id,
        type: "VACATION",
        startDate,
        endDate,
        status: "PENDING",
        source: "EXTERNAL_API",
        notes: `Richiesta via Telegram (chat ${ctx.chatId})`,
      },
    });
    await reply(
      ctx.chatId,
      `✅ Richiesta inviata.\n\nDal <b>${formatItDate(startDate)}</b> al <b>${formatItDate(endDate)}</b>\nStato: <b>In attesa di approvazione</b>\n\nRiceverai un messaggio quando sarà approvata o rifiutata.`
    );
    void leave;
  } catch (err) {
    console.error("[telegram] leave create failed:", err);
    await reply(ctx.chatId, `❌ Errore nella creazione della richiesta. Riprova piu' tardi.`);
  }
};

// parseLeaveDates / formatItDate sono in src/lib/leave-date-parser.ts
// (condiviso con l'ingest email).

// ── Helpers anomalie ─────────────────────────────────────────────────

async function recalcAnomaliesForDay(employee: EmployeeRow, date: string) {
  const dayRecords = await prisma.attendanceRecord.findMany({
    where: { employeeId: employee.id, date },
    orderBy: { declaredTime: "asc" },
  });
  const dr: DailyRecord = {
    employeeId: employee.id,
    employeeName: employee.displayName || employee.name,
    date,
    records: dayRecords.map((r) => ({
      type: r.type as DailyRecord["records"][0]["type"],
      declaredTime: r.declaredTime,
      messageTime: r.messageTime,
    })),
  };
  const dayOfWeek = dowRome();
  const schedule = await prisma.employeeSchedule.findUnique({
    where: { employeeId_dayOfWeek: { employeeId: employee.id, dayOfWeek } },
  });
  const empScheduleDay: EmployeeScheduleDay | null = schedule
    ? {
        block1Start: schedule.block1Start,
        block1End: schedule.block1End,
        block2Start: schedule.block2Start,
        block2End: schedule.block2End,
      }
    : null;
  const stats = calculateDailyStats(dr, empScheduleDay);
  await syncAnomalies([stats]);
}

// ── HTML escape ──────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Dispatcher principale ────────────────────────────────────────────

const COMMAND_MAP: Record<string, CommandHandler> = {
  "/start": handleStart,
  "/help": handleStart,
  "/entrata": handleEntry,
  "/e": handleEntry,
  "/uscita": handleExit,
  "/u": handleExit,
  "/pausa": handlePauseStart,
  "/ip": handlePauseStart,
  "/finepausa": handlePauseEnd,
  "/fp": handlePauseEnd,
  "/stato": handleStato,
  "/s": handleStato,
  "/storico": handleStorico,
  "/ferie": handleFerie,
  "/f": handleFerie,
  "/permesso": handleFerie,
  "/p": handleFerie,
};

const BUTTON_TO_HANDLER: Record<string, CommandHandler> = {
  [BUTTON_ENTRY]: handleEntry,
  [BUTTON_EXIT]: handleExit,
  [BUTTON_PAUSE_START]: handlePauseStart,
  [BUTTON_PAUSE_END]: handlePauseEnd,
};

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message ?? update.edited_message;
  if (!message || !message.text) return;
  if (message.chat.type !== "private") {
    // Ignora gruppi e canali — il bot e' personale
    return;
  }

  const text = message.text.trim();
  const chatIdStr = String(message.chat.id);

  // 1. Risolvi employee. Se sconosciuto, rispondi con il chat_id.
  const employee = await resolveEmployee(message);
  if (!employee) {
    const bot = getTelegramBot();
    if (bot) {
      const display = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || "utente";
      try {
        await bot.sendMessage({
          chat_id: chatIdStr,
          text:
            `👋 Ciao ${escapeHtml(display)},\n\n` +
            `non sei ancora associato a un dipendente.\n\n` +
            `Comunica all'amministratore HR il tuo identificativo:\n\n` +
            `<code>${chatIdStr}</code>\n\n` +
            `L'amministratore lo collegherà al tuo profilo da Impostazioni → Bot Telegram.\n\n` +
            `Una volta associato potrai usare /start per cominciare.`,
          parse_mode: "HTML",
        });
      } catch (err) {
        console.error("[telegram] greeting unknown failed:", err);
      }
    }
    return;
  }

  // 2. Match comando o bottone
  const ctx: CommandContext = { message, chatId: chatIdStr, employee };

  // Bottone esatto?
  if (BUTTON_TO_HANDLER[text]) {
    await BUTTON_TO_HANDLER[text](ctx, "");
    return;
  }

  // Comando /xxx [args...]
  if (text.startsWith("/")) {
    const spaceIdx = text.indexOf(" ");
    const cmd = (spaceIdx >= 0 ? text.slice(0, spaceIdx) : text).toLowerCase();
    // Telegram a volte aggiunge @nomebot ai comandi nei gruppi
    const cmdClean = cmd.split("@")[0];
    const args = spaceIdx >= 0 ? text.slice(spaceIdx + 1) : "";
    const handler = COMMAND_MAP[cmdClean];
    if (handler) {
      await handler(ctx, args);
      return;
    }
    await reply(ctx.chatId, `Comando non riconosciuto. Usa /help per la lista.`);
    return;
  }

  // Testo libero senza comando
  await reply(ctx.chatId, `Usa i pulsanti qui sotto o digita /help per la lista dei comandi.`);
}

// ── Notifica al dipendente: ferie approvata/rifiutata ────────────────

export async function notifyLeaveDecision(args: {
  employeeChatId: string | null;
  status: "APPROVED" | "REJECTED";
  startDate: string;
  endDate: string;
  type: string;
  notes?: string | null;
}) {
  if (!args.employeeChatId) return;
  const bot = getTelegramBot();
  if (!bot) return;

  const isApproved = args.status === "APPROVED";
  const icon = isApproved ? "✅" : "❌";
  const verb = isApproved ? "approvata" : "rifiutata";
  const period =
    args.startDate === args.endDate
      ? formatItDate(args.startDate)
      : `dal ${formatItDate(args.startDate)} al ${formatItDate(args.endDate)}`;

  const lines = [`${icon} La tua richiesta di ferie è stata <b>${verb}</b>.`, ``, `Periodo: <b>${period}</b>`];
  if (args.notes) lines.push(`Note: ${escapeHtml(args.notes)}`);

  try {
    await bot.sendMessage({
      chat_id: args.employeeChatId,
      text: lines.join("\n"),
      parse_mode: "HTML",
      reply_markup: PUNCH_KEYBOARD,
    });
  } catch (err) {
    console.error("[telegram] notifyLeaveDecision failed:", err);
  }
}
