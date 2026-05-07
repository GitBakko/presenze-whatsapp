/**
 * Autenticazione per il WebSocket server di notifiche.
 *
 * Il server WS gira su una porta dedicata (3101) ma riceve l'handshake
 * HTTP dietro reverse proxy IIS/ARR, che inoltra tutti gli header
 * inclusi i Cookie di sessione NextAuth. Decodifichiamo qui il JWT
 * direttamente dal cookie (stesso formato / stesso secret usato da
 * `next-auth`) per conoscere `role` + `employeeId` dell'utente
 * prima di sottoscriverlo al bus.
 *
 * Senza un session cookie valido la connessione viene rifiutata
 * (ws.close(1008)). Questo impedisce a un dipendente di ricevere le
 * timbrature altrui anche solo sul canale di rete.
 */

import type { IncomingMessage } from "http";
import { decode } from "next-auth/jwt";

export interface WsAuthUser {
  id: string;
  role: "ADMIN" | "EMPLOYEE";
  active: boolean;
  employeeId: string | null;
}

const SECRET = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;

// NextAuth v5 default cookie names (prefix depends on secure context)
const COOKIE_CANDIDATES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
];

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k && !(k in out)) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

export async function authenticateWsRequest(
  req: IncomingMessage
): Promise<WsAuthUser | null> {
  if (!SECRET) return null;
  const cookies = parseCookies(req.headers.cookie);
  for (const name of COOKIE_CANDIDATES) {
    const raw = cookies[name];
    if (!raw) continue;
    try {
      const token = await decode({
        token: raw,
        secret: SECRET,
        salt: name,
      });
      if (!token) continue;
      const role = (token.role as string) === "ADMIN" ? "ADMIN" : "EMPLOYEE";
      const id = (token.id as string) || (token.sub as string) || "";
      const active = (token.active as boolean) ?? false;
      const employeeId = (token.employeeId as string | null) ?? null;
      if (!id || !active) return null;
      return { id, role, active, employeeId };
    } catch {
      continue;
    }
  }
  return null;
}
