/**
 * Client minimale per Microsoft Graph API con client credentials flow.
 *
 * Zero dipendenze: usa solo `fetch` nativo (Node ≥20).
 *
 * Scope: solo le operazioni che ci servono per l'ingest email:
 *   - acquisizione token OAuth2 client credentials (con cache in-memory)
 *   - list mail folders per trovare l'id di "Ferie"
 *   - list messages unread in una folder
 *   - get single message con body
 *   - patch isRead=true
 *   - sendMail
 *
 * Configurazione via env vars:
 *   MAIL_TENANT_ID       — tenant Azure AD (GUID)
 *   MAIL_CLIENT_ID       — app registration Client ID
 *   MAIL_CLIENT_SECRET   — app registration Secret (value)
 *   MAIL_MAILBOX         — UPN della mailbox target, es. hr@epartner.it
 *                         (oppure user alias; Graph accetta UPN primario o alias)
 *
 * Permessi Graph necessari sull'app registration (Application, admin consent):
 *   - Mail.ReadWrite
 *   - Mail.Send
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TOKEN_BUFFER_MS = 60_000; // rinnova il token 1 minuto prima della scadenza

interface TokenCache {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let _tokenCache: TokenCache | null = null;

export function isMailGraphConfigured(): boolean {
  return !!(
    process.env.MAIL_TENANT_ID &&
    process.env.MAIL_CLIENT_ID &&
    process.env.MAIL_CLIENT_SECRET &&
    process.env.MAIL_MAILBOX
  );
}

export function getMailbox(): string {
  const m = process.env.MAIL_MAILBOX;
  if (!m) throw new Error("MAIL_MAILBOX non configurato");
  return m;
}

/**
 * Ottiene un access token client-credentials per Microsoft Graph.
 * Cachea in memoria e lo rinnova automaticamente quando e' prossimo
 * alla scadenza.
 */
export async function getGraphToken(): Promise<string> {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt - TOKEN_BUFFER_MS > now) {
    return _tokenCache.accessToken;
  }

  const tenant = process.env.MAIL_TENANT_ID;
  const clientId = process.env.MAIL_CLIENT_ID;
  const clientSecret = process.env.MAIL_CLIENT_SECRET;
  if (!tenant || !clientId || !clientSecret) {
    throw new Error("MAIL_TENANT_ID / MAIL_CLIENT_ID / MAIL_CLIENT_SECRET non configurati");
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Azure AD token fetch failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
    token_type: string;
  };

  _tokenCache = {
    accessToken: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  };
  return json.access_token;
}

/**
 * Chiamata generica a Graph. Gestisce l'autenticazione, il retry su 401
 * (token scaduto fuori tempo massimo) e il parsing degli errori.
 */
async function graphCall<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const attempt = async (token: string) => {
    const res = await fetch(`${GRAPH_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return res;
  };

  let token = await getGraphToken();
  let res = await attempt(token);

  if (res.status === 401) {
    // invalida cache e riprova
    _tokenCache = null;
    token = await getGraphToken();
    res = await attempt(token);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Graph ${method} ${path} failed (${res.status}): ${text}`);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

// ── Tipi Graph (subset di quel che usiamo) ──────────────────────────

export interface GraphMailFolder {
  id: string;
  displayName: string;
  parentFolderId?: string;
  childFolderCount?: number;
  unreadItemCount?: number;
  totalItemCount?: number;
}

export interface GraphEmailAddress {
  name?: string;
  address?: string;
}

export interface GraphMessage {
  id: string;
  internetMessageId?: string;
  subject?: string;
  from?: { emailAddress?: GraphEmailAddress };
  receivedDateTime?: string;
  isRead?: boolean;
  bodyPreview?: string;
  body?: {
    contentType: "text" | "html";
    content: string;
  };
}

// ── API ad alto livello ─────────────────────────────────────────────

/** Elenca tutte le mail folder della mailbox (piatto, primo livello + sotto). */
export async function listMailFolders(): Promise<GraphMailFolder[]> {
  const mailbox = getMailbox();
  const folders: GraphMailFolder[] = [];
  // root folders
  const root = await graphCall<{ value: GraphMailFolder[] }>(
    "GET",
    `/users/${encodeURIComponent(mailbox)}/mailFolders?$top=100`
  );
  for (const f of root.value) {
    folders.push(f);
    if (f.childFolderCount && f.childFolderCount > 0) {
      const children = await graphCall<{ value: GraphMailFolder[] }>(
        "GET",
        `/users/${encodeURIComponent(mailbox)}/mailFolders/${f.id}/childFolders?$top=100`
      );
      for (const c of children.value) folders.push(c);
    }
  }
  return folders;
}

/**
 * Trova l'id di una folder per nome (case insensitive). Cerca sia a root
 * level che nelle subfolder di primo livello. Restituisce null se non trovata.
 */
export async function findFolderIdByName(name: string): Promise<string | null> {
  const needle = name.trim().toLowerCase();
  const folders = await listMailFolders();
  const match = folders.find((f) => f.displayName.toLowerCase() === needle);
  return match?.id ?? null;
}

/** Elenca i messaggi non letti in una folder, ordinati per data ricezione. */
export async function listUnreadInFolder(folderId: string, top = 50): Promise<GraphMessage[]> {
  const mailbox = getMailbox();
  const q = new URLSearchParams({
    $filter: "isRead eq false",
    $top: String(top),
    $orderby: "receivedDateTime asc",
    $select:
      "id,internetMessageId,subject,from,receivedDateTime,isRead,bodyPreview,body",
  });
  const data = await graphCall<{ value: GraphMessage[] }>(
    "GET",
    `/users/${encodeURIComponent(mailbox)}/mailFolders/${folderId}/messages?${q.toString()}`
  );
  return data.value;
}

/** Marca un messaggio come letto. */
export async function markMessageRead(messageId: string): Promise<void> {
  const mailbox = getMailbox();
  await graphCall(
    "PATCH",
    `/users/${encodeURIComponent(mailbox)}/messages/${messageId}`,
    { isRead: true }
  );
}

export interface SendMailArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyToMessageId?: string; // Graph messageId (non internetMessageId)
}

/**
 * Invia una mail via /sendMail. Il From viene preso automaticamente dalla
 * mailbox target; se `MAIL_REPLY_FROM` contiene un display name, viene
 * usato come "name" del mittente (ma l'indirizzo resta quello della
 * mailbox target).
 */
export async function sendMailGraph(args: SendMailArgs): Promise<void> {
  const mailbox = getMailbox();
  const replyFromRaw = process.env.MAIL_REPLY_FROM || "";
  const nameMatch = replyFromRaw.match(/^([^<]+)</);
  const fromName = nameMatch ? nameMatch[1].trim() : undefined;

  const message = {
    subject: args.subject,
    body: {
      contentType: (args.html ? "HTML" : "Text") as "HTML" | "Text",
      content: args.html ?? args.text,
    },
    toRecipients: [{ emailAddress: { address: args.to } }],
    ...(fromName
      ? { from: { emailAddress: { name: fromName, address: mailbox } } }
      : {}),
  };

  if (args.replyToMessageId) {
    // /reply richiede un messaggio sorgente esistente
    await graphCall(
      "POST",
      `/users/${encodeURIComponent(mailbox)}/messages/${args.replyToMessageId}/reply`,
      {
        message: {
          body: {
            contentType: args.html ? "HTML" : "Text",
            content: args.html ?? args.text,
          },
          subject: args.subject,
        },
        comment: "",
      }
    );
    return;
  }

  await graphCall(
    "POST",
    `/users/${encodeURIComponent(mailbox)}/sendMail`,
    {
      message,
      saveToSentItems: true,
    }
  );
}
