/**
 * Wrapper minimale all'API HTTPS Telegram Bot.
 *
 * Zero dipendenze: usa solo `fetch` nativo (Node 20+).
 * Solo i metodi che ci servono: sendMessage, setWebhook, deleteWebhook,
 * getMe, answerCallbackQuery, setMyCommands.
 *
 * Documentazione API: https://core.telegram.org/bots/api
 */

const API_BASE = "https://api.telegram.org";

export interface ReplyKeyboardButton {
  text: string;
}

export interface ReplyKeyboardMarkup {
  keyboard: ReplyKeyboardButton[][];
  resize_keyboard?: boolean;
  is_persistent?: boolean;
  selective?: boolean;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface SendMessageOptions {
  chat_id: string | number;
  text: string;
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
  disable_web_page_preview?: boolean;
  reply_markup?: ReplyKeyboardMarkup | InlineKeyboardMarkup | { remove_keyboard: true };
  reply_to_message_id?: number;
}

export interface BotCommand {
  command: string;
  description: string;
}

export class TelegramBot {
  constructor(private readonly token: string) {
    if (!token) throw new Error("TelegramBot: token mancante");
  }

  private async call<T = unknown>(method: string, body?: unknown): Promise<T> {
    const url = `${API_BASE}/bot${this.token}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!data.ok) {
      throw new Error(`Telegram ${method} failed: ${data.description ?? "unknown"}`);
    }
    return data.result as T;
  }

  sendMessage(opts: SendMessageOptions) {
    return this.call("sendMessage", opts);
  }

  setWebhook(url: string, secretToken?: string) {
    return this.call("setWebhook", {
      url,
      ...(secretToken ? { secret_token: secretToken } : {}),
      drop_pending_updates: false,
    });
  }

  deleteWebhook() {
    return this.call("deleteWebhook", { drop_pending_updates: false });
  }

  getMe() {
    return this.call<{ id: number; username?: string; first_name: string }>("getMe");
  }

  setMyCommands(commands: BotCommand[]) {
    return this.call("setMyCommands", { commands });
  }
}

/** Singleton lazy: il token e' letto da env e cached. */
let _instance: TelegramBot | null = null;
export function getTelegramBot(): TelegramBot | null {
  if (_instance) return _instance;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  _instance = new TelegramBot(token);
  return _instance;
}

// ── Tipi degli update Telegram (subset di quel che ci serve) ──────────

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}
