import { NextResponse } from "next/server";

/**
 * Health-check pubblico chiamato dal servizio Windows allo startup per
 * verificare la connettività LAN col server HR e leggere il `serverTime`
 * (utile a diagnosticare drift dell'orologio del PC postazione).
 *
 * Nessuna auth: l'endpoint è pensato per essere lightweight e raggiungibile
 * anche prima che la API key sia configurata. Non espone dati sensibili.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "presenze-whatsapp",
    serverTime: new Date().toISOString(),
  });
}
