/**
 * Wrapper per invio email via Microsoft Graph.
 *
 * Rimpiazza la vecchia implementazione nodemailer/SMTP che non funzionava
 * sui tenant M365 con Basic Auth deprecata. Usa la stessa app registration
 * del poller (MAIL_TENANT_ID/CLIENT_ID/CLIENT_SECRET) con il permesso
 * Application "Mail.Send".
 *
 * Se Graph non e' configurato, sendMail() ritorna false e logga un
 * warning. Niente eccezioni: un reply mancato non deve far fallire
 * l'ingest.
 */

import { sendMailGraph, isMailGraphConfigured } from "./mail-graph";

export interface SendMailArgs {
  to: string;
  subject: string;
  text: string;
  /**
   * Graph messageId del messaggio originale a cui si sta rispondendo.
   * Se presente, usa /messages/{id}/reply invece di /sendMail per
   * mantenere il threading.
   */
  replyToMessageId?: string;
}

export async function sendMail(args: SendMailArgs): Promise<boolean> {
  if (!isMailGraphConfigured()) {
    console.warn("[mail-send] Graph non configurato, email non inviata");
    return false;
  }
  try {
    await sendMailGraph(args);
    return true;
  } catch (err) {
    console.error("[mail-send] sendMailGraph failed:", err);
    return false;
  }
}

/** True se Graph e' configurato e quindi sendMail e' utilizzabile. */
export function isMailSendConfigured(): boolean {
  return isMailGraphConfigured();
}
