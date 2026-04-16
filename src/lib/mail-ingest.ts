/**
 * Poller Microsoft Graph per le richieste ferie via email.
 *
 * Si connette periodicamente alla mailbox configurata via
 * MAIL_MAILBOX, lista i messaggi non letti nella folder MAIL_FOLDER
 * (default "Ferie"), e per ognuno:
 *   1. check idempotency via EmailIngestLog.messageId
 *   2. lookup Employee per mittente (case insensitive sul from.address)
 *      → se non trovato: log + reply "non autorizzato" + UnrecognizedEmail
 *   3. validazione subject (deve essere "ferie")
 *   4. parse body con parseLeaveDates
 *      → se fallisce: reply errore
 *   5. crea LeaveRequest PENDING + reply conferma
 *   6. marca messaggio come letto via PATCH
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
import { parseLeaveDates } from "./leave-date-parser";
import { sendMail } from "./mail-send";
import {
  replyUnknownSender,
  replyParseError,
  replyRequestAccepted,
} from "./mail-templates";
import {
  isMailGraphConfigured,
  findFolderIdByName,
  listUnreadInFolder,
  markMessageRead,
  type GraphMessage,
} from "./mail-graph";

const MAX_PER_CYCLE = 50;

interface IngestStats {
  scanned: number;
  ok: number;
  unknownSender: number;
  parseError: number;
  duplicate: number;
  internalError: number;
  wrongSubject: number;
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
    console.log("[mail-ingest] Graph non configurato, poller disattivato");
    return;
  }
  _running = true;
  console.log("[mail-ingest] poller avviato (Graph API)");
  scheduleNext(0);
}

export function stopMailPoller() {
  _running = false;
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
}

function scheduleNext(delayMs: number) {
  if (!_running) return;
  _timer = setTimeout(async () => {
    try {
      await runOnce();
    } catch (err) {
      console.error("[mail-ingest] cycle error:", err);
    }
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
  };
  if (!isMailIngestConfigured()) return stats;

  const folderName = process.env.MAIL_FOLDER || "Ferie";

  // 1. Trova la folder per nome
  let folderId: string | null;
  try {
    folderId = await findFolderIdByName(folderName);
  } catch (err) {
    console.error("[mail-ingest] findFolderIdByName failed:", err);
    throw err;
  }
  if (!folderId) {
    console.warn(`[mail-ingest] folder "${folderName}" non trovata nella mailbox`);
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
      console.error("[mail-ingest] processOne failed for message", msg.id, err);
      // Marca come letta comunque per evitare loop su mail problematica
      try {
        await markMessageRead(msg.id);
      } catch {
        // ignore
      }
    }
  }

  console.log("[mail-ingest] cycle done:", stats);
  return stats;
}

async function processOne(msg: GraphMessage, stats: IngestStats) {
  const messageId = msg.internetMessageId || `graph-${msg.id}`;
  const subject = msg.subject || "";
  const fromAddr = msg.from?.emailAddress?.address?.toLowerCase() || "";
  const fromName = msg.from?.emailAddress?.name || "";

  // 1. Filtro subject (deve essere "ferie" dopo aver tolto Re:/Fwd:)
  const subjectClean = subject
    .replace(/^(?:re:|fwd?:|r:)\s*/gi, "")
    .trim()
    .toLowerCase();
  if (subjectClean !== "ferie") {
    // Non destinata al nostro sistema. Marchiamo come letta per non
    // riscansionare ad ogni ciclo. Se una mail finisce nella cartella
    // "Ferie" senza avere subject corretto, e' stata messa li' a mano
    // oppure esisteva prima della regola M365: va comunque ignorata.
    stats.wrongSubject++;
    try {
      await markMessageRead(msg.id);
    } catch (err) {
      console.error("[mail-ingest] markMessageRead (wrongSubject) failed:", err);
    }
    return;
  }

  // 2. Idempotency: gia' processata?
  const existingLog = await prisma.emailIngestLog.findUnique({
    where: { messageId },
  });
  if (existingLog) {
    stats.duplicate++;
    await markMessageRead(msg.id);
    return;
  }

  // 3. Body testuale (Graph gia' ci da' text o html gia' parsato)
  const body = extractBodyText(msg);

  if (!fromAddr) {
    await logIngest(messageId, "", subject, "PARSE_ERROR", "mittente vuoto", null);
    await markMessageRead(msg.id);
    return;
  }

  // 4. Lookup employee per mittente
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

  // 5. Parse delle date
  const parsed = parseLeaveDates(body);
  if (!parsed) {
    stats.parseError++;
    await logIngest(messageId, fromAddr, subject, "PARSE_ERROR", "DAL/AL non riconosciuti", null);
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

  if (parsed.startDate > parsed.endDate) {
    stats.parseError++;
    await logIngest(messageId, fromAddr, subject, "PARSE_ERROR", "endDate < startDate", null);
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

  // 6. Crea LeaveRequest PENDING
  const leave = await prisma.leaveRequest.create({
    data: {
      employeeId: employee.id,
      type: "VACATION",
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      status: "PENDING",
      source: "EXTERNAL_API",
      notes: `Richiesta via email da ${fromAddr}` + (fromName ? ` (${fromName})` : ""),
    },
  });

  stats.ok++;
  await logIngest(messageId, fromAddr, subject, "OK", null, leave.id);

  // 7. Reply conferma
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

  // 8. Marca come letta
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
    console.error("[mail-ingest] logIngest failed:", err);
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
