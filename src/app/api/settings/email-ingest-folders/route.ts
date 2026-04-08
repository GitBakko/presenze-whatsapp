import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { isMailGraphConfigured, listMailFolders } from "@/lib/mail-graph";

/**
 * GET /api/settings/email-ingest-folders
 *
 * Diagnosi: lista TUTTE le mail folders della mailbox configurata via
 * Microsoft Graph. Utile per capire il displayName esatto della
 * sottocartella da mettere in MAIL_FOLDER.
 */
export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;

  if (!isMailGraphConfigured()) {
    return NextResponse.json(
      {
        error:
          "Graph non configurato. Imposta MAIL_TENANT_ID, MAIL_CLIENT_ID, MAIL_CLIENT_SECRET, MAIL_MAILBOX.",
      },
      { status: 503 }
    );
  }

  try {
    const folders = await listMailFolders();
    return NextResponse.json({
      ok: true,
      mailbox: process.env.MAIL_MAILBOX,
      currentConfigured: process.env.MAIL_FOLDER || "Ferie",
      folders: folders.map((f) => ({
        id: f.id,
        displayName: f.displayName,
        parentFolderId: f.parentFolderId,
        childFolderCount: f.childFolderCount,
        unreadItemCount: f.unreadItemCount,
        totalItemCount: f.totalItemCount,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "errore sconosciuto";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
