/**
 * Reply keyboard persistente con i 4 bottoni di timbratura, sempre
 * visibile sotto il campo di input dell'utente. I bottoni inviano
 * letteralmente il testo come messaggio, che il dispatcher
 * (telegram-handlers.ts) intercetta e instrada al comando corrispondente.
 */

import type { ReplyKeyboardMarkup } from "./telegram-bot";

export const BUTTON_ENTRY = "🟢 Entrata";
export const BUTTON_EXIT = "🔴 Uscita";
export const BUTTON_PAUSE_START = "⏸ Inizio pausa";
export const BUTTON_PAUSE_END = "▶️ Fine pausa";

export const PUNCH_KEYBOARD: ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: BUTTON_ENTRY }, { text: BUTTON_EXIT }],
    [{ text: BUTTON_PAUSE_START }, { text: BUTTON_PAUSE_END }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};
