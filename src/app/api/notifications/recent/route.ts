import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { notificationsBus } from "@/lib/notifications-bus";

/**
 * GET /api/notifications/recent
 *
 * Restituisce gli eventi recenti dal buffer in-memory del notifications
 * bus. Usato dal client in modalità polling (fallback quando SSE non
 * funziona attraverso IIS/ARR che bufferizza gli stream).
 *
 * Auth: checkAuth (sessione admin).
 */
export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;

  const events = notificationsBus.recent();
  return NextResponse.json({ events });
}
