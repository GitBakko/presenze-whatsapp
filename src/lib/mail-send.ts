/**
 * Wrapper SMTP minimale su nodemailer.
 *
 * Configurazione via env vars:
 *   MAIL_SMTP_HOST
 *   MAIL_SMTP_PORT       (default 587)
 *   MAIL_SMTP_USER
 *   MAIL_SMTP_PASSWORD
 *   MAIL_SMTP_SECURE     ("true" => SSL su 465, "false" o omesso => STARTTLS)
 *   MAIL_REPLY_FROM      es. "HR Presenze <ferie@epartner.it>"
 *
 * Se non configurato, sendMail() restituisce false e logga un warning.
 * Niente eccezioni, perche' una mail di reply mancata non deve far
 * fallire l'ingest.
 */

import nodemailer, { type Transporter } from "nodemailer";

let _transporter: Transporter | null = null;
let _initialized = false;

function init(): Transporter | null {
  if (_initialized) return _transporter;
  _initialized = true;

  const host = process.env.MAIL_SMTP_HOST;
  const user = process.env.MAIL_SMTP_USER;
  const pass = process.env.MAIL_SMTP_PASSWORD;
  if (!host || !user || !pass) {
    console.warn("[mail-send] SMTP non configurato (MAIL_SMTP_HOST/USER/PASSWORD mancanti)");
    return null;
  }

  const port = parseInt(process.env.MAIL_SMTP_PORT || "587", 10);
  const secure = (process.env.MAIL_SMTP_SECURE || "").toLowerCase() === "true";

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  return _transporter;
}

export interface SendMailArgs {
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;       // Message-ID a cui rispondere (per il threading)
  references?: string;      // header References per il threading
}

export async function sendMail(args: SendMailArgs): Promise<boolean> {
  const t = init();
  if (!t) return false;

  const from = process.env.MAIL_REPLY_FROM || process.env.MAIL_SMTP_USER;
  if (!from) {
    console.warn("[mail-send] MAIL_REPLY_FROM non configurato");
    return false;
  }

  try {
    await t.sendMail({
      from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      ...(args.inReplyTo ? { inReplyTo: args.inReplyTo } : {}),
      ...(args.references ? { references: args.references } : {}),
    });
    return true;
  } catch (err) {
    console.error("[mail-send] sendMail failed:", err);
    return false;
  }
}

/** True se SMTP e' configurato (utile per gating). */
export function isMailSendConfigured(): boolean {
  return !!(process.env.MAIL_SMTP_HOST && process.env.MAIL_SMTP_USER && process.env.MAIL_SMTP_PASSWORD);
}
