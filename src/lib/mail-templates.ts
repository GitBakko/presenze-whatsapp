/**
 * Template di testo per le email automatiche dell'ingest.
 *
 * Tutti i template sono solo plain text — niente HTML — per massima
 * compatibilita' con client mail eterogenei e per evitare di sembrare
 * spam.
 *
 * Le funzioni restituiscono { subject, text } pronti per nodemailer.
 */

import { formatItDate } from "./leave-date-parser";

const FOOTER = "\n\n— HR Presenze\nQuesta è un'email automatica, non rispondere.";

const FORMATO_ESEMPIO = `Formato corretto:
  Oggetto: ferie
  Corpo:
    DAL 15/04/2026
    AL 18/04/2026

Date accettate: GG/MM/AAAA o GG/MM (anno corrente).
Solo giornate intere.`;

export interface MailReply {
  subject: string;
  text: string;
}

/** Risposta a un mittente non riconosciuto (email non in tabella Employee). */
export function replyUnknownSender(originalSubject: string): MailReply {
  return {
    subject: `Re: ${originalSubject || "ferie"} — indirizzo non autorizzato`,
    text:
      "Ciao,\n\n" +
      "il tuo indirizzo non risulta associato a nessun dipendente registrato. " +
      "Per inviare richieste di ferie via email, contatta l'amministratore HR " +
      "e fagli associare il tuo indirizzo email al tuo profilo." +
      FOOTER,
  };
}

/** Risposta su corpo malformato. */
export function replyParseError(originalSubject: string): MailReply {
  return {
    subject: `Re: ${originalSubject || "ferie"} — formato richiesta non valido`,
    text:
      "Ciao,\n\n" +
      "non sono riuscito a interpretare la tua richiesta di ferie.\n\n" +
      FORMATO_ESEMPIO +
      "\n\nRiprova a inviare la richiesta con il formato corretto." +
      FOOTER,
  };
}

/** Risposta di conferma quando la richiesta e' stata accettata in PENDING. */
export function replyRequestAccepted(args: {
  originalSubject: string;
  startDate: string;
  endDate: string;
  employeeName: string;
}): MailReply {
  const period =
    args.startDate === args.endDate
      ? formatItDate(args.startDate)
      : `dal ${formatItDate(args.startDate)} al ${formatItDate(args.endDate)}`;
  return {
    subject: `Re: ${args.originalSubject || "ferie"} — richiesta acquisita`,
    text:
      `Ciao ${args.employeeName},\n\n` +
      `la tua richiesta di ferie è stata acquisita.\n\n` +
      `Periodo: ${period}\n` +
      `Stato: in attesa di approvazione\n\n` +
      `Riceverai una nuova email quando l'amministratore l'avrà approvata o rifiutata.` +
      FOOTER,
  };
}

/**
 * Notifica al dipendente quando un admin cancella una richiesta
 * esistente (indipendentemente dallo status precedente: PENDING,
 * APPROVED, REJECTED).
 */
export function leaveCancellationNotification(args: {
  previousStatus: "PENDING" | "APPROVED" | "REJECTED";
  startDate: string;
  endDate: string;
  employeeName: string;
  reason?: string | null;
}): MailReply {
  const period =
    args.startDate === args.endDate
      ? formatItDate(args.startDate)
      : `dal ${formatItDate(args.startDate)} al ${formatItDate(args.endDate)}`;

  const statusLabel =
    args.previousStatus === "APPROVED"
      ? "già approvata"
      : args.previousStatus === "PENDING"
      ? "in attesa di approvazione"
      : "rifiutata";

  let text =
    `Ciao ${args.employeeName},\n\n` +
    `la tua richiesta di ferie ${statusLabel} per il periodo ${period} ` +
    `è stata cancellata dall'amministratore.\n`;
  if (args.reason && args.reason.trim()) {
    text += `\nMotivo:\n${args.reason.trim()}\n`;
  }
  if (args.previousStatus === "APPROVED") {
    text +=
      `\nATTENZIONE: queste ferie erano già state approvate. ` +
      `Assicurati di essere al lavoro nei giorni indicati.\n`;
  }
  text += FOOTER;

  return {
    subject: "Ferie cancellate",
    text,
  };
}

/** Notifica al dipendente quando un admin approva o rifiuta una richiesta. */
export function leaveDecisionNotification(args: {
  status: "APPROVED" | "REJECTED";
  startDate: string;
  endDate: string;
  employeeName: string;
  notes?: string | null;
}): MailReply {
  const isApproved = args.status === "APPROVED";
  const period =
    args.startDate === args.endDate
      ? formatItDate(args.startDate)
      : `dal ${formatItDate(args.startDate)} al ${formatItDate(args.endDate)}`;
  const subject = isApproved
    ? "Ferie approvate"
    : "Ferie rifiutate";
  const verb = isApproved ? "approvata" : "rifiutata";

  let text = `Ciao ${args.employeeName},\n\n` +
    `la tua richiesta di ferie è stata ${verb}.\n\n` +
    `Periodo: ${period}\n`;
  if (args.notes && args.notes.trim()) {
    text += `\nNote dell'amministratore:\n${args.notes.trim()}\n`;
  }
  text += FOOTER;

  return { subject, text };
}
