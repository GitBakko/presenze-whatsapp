/**
 * Poller Microsoft Graph per le richieste di assenza via email.
 *
 * Si connette periodicamente alla mailbox configurata via
 * MAIL_MAILBOX, lista i messaggi non letti nella folder MAIL_FOLDER
 * (default "Ferie"), e per ognuno:
 *   1. check idempotency via EmailIngestLog.messageId
 *   2. lookup Employee per mittente (case insensitive sul from.address)
 *      → se non trovato: log + reply "non autorizzato" + UnrecognizedEmail
 *   3. detectLeaveTypeFromSubject (ferie / ROL / permesso / malattia /
 *      lutto / matrimonio / visita medica / 104)
 *      → se nessun tipo riconosciuto: reply TYPE_UNKNOWN
 *   4. parse body con parseLeaveDates(body, todayRome())
 *      → PAST_DATE: reply dedicata
 *      → INVALID_RANGE / PARSE_ERROR: reply generico
 *   5. checkOverlap contro le richieste esistenti
 *      → BLOCK: reply conflitto, niente create
 *   6. crea LeaveRequest PENDING con il tipo rilevato + reply conferma
 *   7. marca messaggio come letto via PATCH
 *
 * Tutto il flusso e' protetto da try/catch granulari: una mail rotta
 * non blocca le altre.
 *
 * Singleton: il poller viene avviato una sola volta a server start
 * via instrumentation.ts. Se le env Graph non sono configurate, il
 * poller fa no-op silenzioso.
 */

import { createHash } from "crypto";
import { prisma } from "./db";
import { parseLeaveDates, detectLeaveTypeFromSubject } from "./leaves/validation";
import { checkOverlap, supersedePredictorLeaves } from "./leaves/overlap";
import { todayRome } from "./tz";
import { sendMail } from "./mail-send";
import {
  replyUnknownSender,
  replyParseError,
  replyRequestAccepted,
  replyTypeUnknown,
  replyPastDate,
  replyOverlap,
} from "./mail-templates";
import {
  isMailGraphConfigured,
  findFolderIdByName,
  listUnreadInFolder,
  markMessageRead,
  type GraphMessage,
} from "./mail-graph";
import { logger } from "./logger";
import { recordRunning, recordTick, setStartedAt } from "./worker-metrics";

const MAX_PER_CYCLE = 50;
const WORKER = "mail-ingest";

interface IngestStats {
  scanned: number;
  ok: number;
  unknownSender: number;
  parseError: number;
  duplicate: number;
  internalError: number;
  wrongSubject: number;
  typeUnknown: number;
  pastDate: number;
  overlapBlock: number;
}

let _running = false;
let _timer: ReturnType<typeof setTimeout> | null = null;

export function isMailIngestConfigured(): boolean {
  return isMailGraphConfigured();
}

/** Avvia il poller. Idempotente. */
export function ensureMailPollerStarted() {
  if (_running) return;
  if (!isMailIngestConfigured()) {
    logger.info({ worker: WORKER }, "graph not configured, poller disabled");
    return;
  }
  _running = true;
  setStartedAt(WORKER);
  recordRunning(WORKER, true);
  logger.info({ worker: WORKER }, "poller started (Graph API)");
  scheduleNext(0);
}

export function stopMailPoller() {
  _running = false;
  recordRunning(WORKER, false);
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
}

function scheduleNext(delayMs: number) {
  if (!_running) return;
  _timer = setTimeout(async () => {
    const started = Date.now();
    let ok = true;
    let errorMessage: string | undefined;
    try {
      await runOnce();
    } catch (err) {
      ok = false;
      errorMessage = String(err);
      logger.error({ worker: WORKER, err: String(err) }, "cycle error");
    }
    recordTick(WORKER, { ok, durationMs: Date.now() - started, errorMessage });
    const intervalSec = parseInt(process.env.MAIL_POLL_INTERVAL_SEC || "120", 10);
    scheduleNext(intervalSec * 1000);
  }, delayMs);
}

/**
 * Esegue un singolo ciclo di ingest. Esportata per poterla invocare
 * manualmente da una API admin (es. "Esegui ora") o per i test.
 */
export async function runOnce(): Promise<IngestStats> {
  const stats: IngestStats = {
    scanned: 0,
    ok: 0,
    unknownSender: 0,
    parseError: 0,
    duplicate: 0,
    internalError: 0,
    wrongSubject: 0,
    typeUnknown: 0,
    pastDate: 0,
    overlapBlock: 0,
  };
  if (!isMailIngestConfigured()) return stats;

  const folderName = process.env.MAIL_FOLDER || "Ferie";

  // 1. Trova la folder per nome
  let folderId: string | null;
  try {
    folderId = await findFolderIdByName(folderName);
  } catch (err) {
    logger.error({ worker: WORKER, err: String(err) }, "findFolderIdByName failed");
    throw err;
  }
  if (!folderId) {
    logger.warn({ worker: WORKER, folder: folderName }, "folder not found in mailbox");
    return stats;
  }

  // 2. Lista messaggi non letti
  const messages = await listUnreadInFolder(folderId, MAX_PER_CYCLE);
  if (messages.length === 0) return stats;

  for (const msg of messages) {
    stats.scanned++;
    try {
      await processOne(msg, stats);
    } catch (err) {
      stats.internalError++;
      logger.error({ worker: WORKER, msgId: msg.id, err: String(err) }, "processOne failed");
      // Marca come letta comunque per evitare loop su mail problematica
      try {
        await markMessageRead(msg.id);
      } catch {
        // ignore
      }
    }
  }

  logger.info({ worker: WORKER, ...stats }, "cycle done");
  return stats;
}

async function processOne(msg: GraphMessage, stats: IngestStats) {
  const messageId = msg.internetMessageId || `graph-${msg.id}`;
  const subject = msg.subject || "";
  const fromAddr = msg.from?.emailAddress?.address?.toLowerCase() || "";
  const fromName = msg.from?.emailAddress?.name || "";

  // 1. Idempotency: gia' processata?
  const existingLog = await prisma.emailIngestLog.findUnique({
    where: { messageId },
  });
  if (existingLog) {
    stats.duplicate++;
    await markMessageRead(msg.id);
    return;
  }

  // 2. Body testuale (Graph gia' ci da' text o html gia' parsato)
  const body = extractBodyText(msg);

  if (!fromAddr) {
    await logIngest(messageId, "", subject, "PARSE_ERROR", "mittente vuoto", null);
    await markMessageRead(msg.id);
    return;
  }

  // 3. Lookup employee per mittente
  const employee = await prisma.employee.findUnique({ where: { email: fromAddr } });
  if (!employee) {
    stats.unknownSender++;
    await logIngest(messageId, fromAddr, subject, "UNKNOWN_SENDER", null, null);
    const unkId = unrecognizedKey(fromAddr);
    await prisma.unrecognizedEmail.upsert({
      where: { id: unkId },
      create: {
        id: unkId,
        fromAddress: fromAddr,
        subject,
        snippet: body.slice(0, 200),
      },
      update: {
        receivedAt: new Date(),
        attempts: { increment: 1 },
        snippet: body.slice(0, 200),
      },
    });
    const reply = replyUnknownSender(subject);
    await sendMail({
      to: fromAddr,
      subject: reply.subject,
      text: reply.text,
      html: reply.html,
      replyToMessageId: msg.id,
    });
    await markMessageRead(msg.id);
    return;
  }

  // 4. Type detection dal subject (sostituisce il vecchio filtro "ferie" hardcoded)
  const type = detectLeaveTypeFromSubject(subject);
  if (!type) {
    stats.typeUnknown++;
    await logIngest(messageId, fromAddr, subject, "TYPE_UNKNOWN", null, null);
    const reply = replyTypeUnknown();
    await sendMail({
      to: fromAddr,
      subject: reply.subject,
      text: reply.text,
      html: reply.html,
      replyToMessageId: msg.id,
    });
    await markMessageRead(msg.id);
    return;
  }

  // 5. Parse delle date
  const parsed = parseLeaveDates(body, todayRome());
  if (!parsed.ok) {
    if (parsed.reason === "PAST_DATE") {
      stats.pastDate++;
      await logIngest(messageId, fromAddr, subject, "PAST_DATE", parsed.detail ?? null, null);
      const reply = replyPastDate(parsed.detail ?? "");
      await sendMail({
        to: fromAddr,
        subject: reply.subject,
        text: reply.text,
        html: reply.html,
        replyToMessageId: msg.id,
      });
      await markMessageRead(msg.id);
      return;
    }
    const detail =
      parsed.reason === "INVALID_RANGE"
        ? `endDate < startDate (${parsed.detail ?? ""})`
        : "DAL/AL non riconosciuti";
    stats.parseError++;
    await logIngest(messageId, fromAddr, subject, "PARSE_ERROR", detail, null);
    const reply = replyParseError(subject);
    await sendMail({
      to: fromAddr,
      subject: reply.subject,
      text: reply.text,
      html: reply.html,
      replyToMessageId: msg.id,
    });
    await markMessageRead(msg.id);
    return;
  }

  // 6. Overlap check con richieste esistenti
  const overlap = await checkOverlap(employee.id, {
    type,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
  });
  if (overlap.kind === "BLOCK") {
    stats.overlapBlock++;
    await logIngest(
      messageId,
      fromAddr,
      subject,
      "OVERLAP_BLOCK",
      overlap.reason ?? null,
      null
    );
    const reply = replyOverlap(
      overlap.conflicts.map(c => ({
        type: c.type,
        startDate: c.startDate,
        endDate: c.endDate,
      }))
    );
    await sendMail({
      to: fromAddr,
      subject: reply.subject,
      text: reply.text,
      html: reply.html,
      replyToMessageId: msg.id,
    });
    await markMessageRead(msg.id);
    return;
  }

  // 7. Crea LeaveRequest PENDING (sovrascrivendo eventuali giorni del predittore)
  await supersedePredictorLeaves(employee.id, parsed.startDate, parsed.endDate);
  const leave = await prisma.leaveRequest.create({
    data: {
      employeeId: employee.id,
      type,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      status: "PENDING",
      source: "EXTERNAL_API",
      notes: `Richiesta via email da ${fromAddr}` + (fromName ? ` (${fromName})` : ""),
    },
  });

  stats.ok++;
  await logIngest(messageId, fromAddr, subject, "OK", null, leave.id);

  // 8. Reply conferma
  const reply = replyRequestAccepted({
    originalSubject: subject,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    employeeName: employee.displayName || employee.name,
  });
  await sendMail({
    to: fromAddr,
    subject: reply.subject,
    text: reply.text,
    html: reply.html,
    replyToMessageId: msg.id,
  });

  // 9. Marca come letta
  await markMessageRead(msg.id);
}

// ── Helpers ──────────────────────────────────────────────────────────

async function logIngest(
  messageId: string,
  fromAddress: string,
  subject: string,
  status: string,
  errorDetail: string | null,
  leaveRequestId: string | null
) {
  try {
    await prisma.emailIngestLog.upsert({
      where: { messageId },
      create: {
        messageId,
        fromAddress,
        subject,
        status,
        errorDetail,
        leaveRequestId,
      },
      update: {},
    });
  } catch (err) {
    logger.error({ worker: WORKER, err: String(err) }, "logIngest failed");
  }
}

function unrecognizedKey(fromAddress: string): string {
  return "unk-" + createHash("sha256").update(fromAddress).digest("hex").slice(0, 24);
}

/**
 * Estrae testo plain dal body Graph. Se e' HTML, fa strip dei tag.
 * Graph restituisce bodyPreview (pulito) ma e' troncato a ~255 char.
 * body.content ha tutto: se text => direct, se html => strip.
 */
function extractBodyText(msg: GraphMessage): string {
  const body = msg.body;
  if (!body?.content) return msg.bodyPreview || "";
  if (body.contentType === "text") return body.content;
  // HTML → strip
  return body.content
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
