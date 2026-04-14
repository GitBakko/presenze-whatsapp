"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, MessageCircle, Trash2, Link2, Link2Off, RefreshCw } from "lucide-react";
import { useConfirm } from "@/components/ConfirmProvider";

interface Employee {
  id: string;
  name: string;
  displayName: string | null;
  telegramChatId: string | null;
  telegramUsername: string | null;
}

interface UnrecognizedChat {
  id: string;
  chatId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  attempts: number;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function displayChat(c: UnrecognizedChat): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
  if (c.username) return `@${c.username}${name ? " (" + name + ")" : ""}`;
  return name || `chat ${c.chatId}`;
}

export default function TelegramSettingsPage() {
  const confirm = useConfirm();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [unrecognized, setUnrecognized] = useState<UnrecognizedChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingAssoc, setPendingAssoc] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, { chatId: string; username: string }>>({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, unkRes] = await Promise.all([
        fetch("/api/employees"),
        fetch("/api/settings/unrecognized-telegram"),
      ]);
      const emps: Employee[] = await empRes.json();
      const unks: UnrecognizedChat[] = await unkRes.json();
      emps.sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name));
      setEmployees(emps);
      setUnrecognized(unks);
    } catch {
      toast.error("Errore nel caricamento dei dati");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleAssociate = async (chat: UnrecognizedChat) => {
    const empId = pendingAssoc[chat.id];
    if (!empId) {
      toast.warning("Seleziona prima un dipendente");
      return;
    }
    try {
      const fd = new FormData();
      fd.append("telegramChatId", chat.chatId);
      if (chat.username) fd.append("telegramUsername", chat.username);
      const res = await fetch(`/api/employees/${empId}`, { method: "PUT", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || `Errore ${res.status}`);
        return;
      }
      await fetch(`/api/settings/unrecognized-telegram?id=${chat.id}`, { method: "DELETE" });
      toast.success("Chat associata al dipendente");
      setPendingAssoc((p) => {
        const rest = { ...p };
        delete rest[chat.id];
        return rest;
      });
      loadAll();
    } catch {
      toast.error("Errore di rete");
    }
  };

  const handleIgnore = async (chat: UnrecognizedChat) => {
    const ok = await confirm({
      title: "Rimuovi chat",
      message: "Eliminare questa chat dalla lista? Se l'utente scriverà di nuovo al bot riapparirà.",
      confirmLabel: "Rimuovi",
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/settings/unrecognized-telegram?id=${chat.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(`Errore ${res.status}`);
        return;
      }
      toast.success("Chat rimossa");
      loadAll();
    } catch {
      toast.error("Errore di rete");
    }
  };

  const startEdit = (e: Employee) => {
    setEditing((prev) => ({
      ...prev,
      [e.id]: {
        chatId: e.telegramChatId || "",
        username: e.telegramUsername || "",
      },
    }));
  };

  const cancelEdit = (empId: string) => {
    setEditing((prev) => {
      const rest = { ...prev };
      delete rest[empId];
      return rest;
    });
  };

  const saveEdit = async (empId: string) => {
    const ed = editing[empId];
    if (!ed) return;
    try {
      const fd = new FormData();
      fd.append("telegramChatId", ed.chatId);
      fd.append("telegramUsername", ed.username);
      const res = await fetch(`/api/employees/${empId}`, { method: "PUT", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || `Errore ${res.status}`);
        return;
      }
      toast.success("Associazione aggiornata");
      cancelEdit(empId);
      loadAll();
    } catch {
      toast.error("Errore di rete");
    }
  };

  const handleUnlink = async (empId: string) => {
    const ok = await confirm({
      title: "Scollega bot",
      message: "Scollegare il bot Telegram da questo dipendente?",
      confirmLabel: "Scollega",
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.append("telegramChatId", "");
    fd.append("telegramUsername", "");
    const res = await fetch(`/api/employees/${empId}`, { method: "PUT", body: fd });
    if (res.ok) {
      toast.success("Bot scollegato");
      loadAll();
    } else {
      toast.error("Errore nello scollegamento");
    }
  };

  const unassignedEmployees = employees.filter((e) => !e.telegramChatId);
  const assignedEmployees = employees.filter((e) => !!e.telegramChatId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Impostazioni
          </Link>
          <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-primary flex items-center gap-2">
            <MessageCircle className="h-7 w-7 text-sky-500" /> Bot Telegram
          </h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Associa i chat Telegram dei dipendenti al loro profilo. Una volta associato, il dipendente può timbrare e richiedere ferie scrivendo al bot.
          </p>
        </div>
        <button
          type="button"
          onClick={loadAll}
          className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container px-3 py-2 text-sm font-medium text-on-surface hover:bg-surface-container-high"
        >
          <RefreshCw className="h-4 w-4" /> Aggiorna
        </button>
      </div>

      <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        <p>
          <strong>Come funziona:</strong> il dipendente apre Telegram, cerca <code className="font-mono">@ep-bot</code> (o il nome configurato), digita <code className="font-mono">/start</code>. Riceve un identificativo numerico che ti comunica. Tu lo trovi qui sotto in &quot;Chat non associate&quot; e lo colleghi al suo profilo.
        </p>
      </div>

      {loading && <div className="text-sm text-on-surface-variant">Caricamento…</div>}

      {!loading && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-on-surface">
              Chat non associate{" "}
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                {unrecognized.length}
              </span>
            </h2>
            {unrecognized.length === 0 ? (
              <div className="rounded-lg border border-dashed border-surface-container-high bg-surface-container-lowest p-6 text-center text-sm text-on-surface-variant">
                Nessuna chat in attesa di associazione. Quando un dipendente scriverà al bot, comparirà qui.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg bg-surface-container-lowest shadow-card">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-container-low text-xs uppercase tracking-wide text-on-surface-variant">
                    <tr>
                      <th className="px-4 py-2">Utente Telegram</th>
                      <th className="px-4 py-2">Chat ID</th>
                      <th className="px-4 py-2">Ultimo messaggio</th>
                      <th className="px-4 py-2 text-center">Tentativi</th>
                      <th className="px-4 py-2">Associa a</th>
                      <th className="px-4 py-2 text-right">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unrecognized.map((c) => (
                      <tr key={c.id} className="border-b border-surface-container">
                        <td className="px-4 py-3 font-medium">{displayChat(c)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{c.chatId}</td>
                        <td className="px-4 py-3">{formatDateTime(c.lastSeenAt)}</td>
                        <td className="px-4 py-3 text-center">{c.attempts}</td>
                        <td className="px-4 py-3">
                          <select
                            value={pendingAssoc[c.id] || ""}
                            onChange={(e) => setPendingAssoc((p) => ({ ...p, [c.id]: e.target.value }))}
                            className="rounded border-0 bg-surface-container-highest px-2 py-1 text-sm focus:ring-1 focus:ring-primary/20"
                          >
                            <option value="">— scegli dipendente —</option>
                            {unassignedEmployees.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.displayName || e.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleAssociate(c)}
                              disabled={!pendingAssoc[c.id]}
                              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-on-primary hover:bg-primary/90 disabled:opacity-40"
                            >
                              <Link2 className="h-3 w-3" /> Associa
                            </button>
                            <button
                              type="button"
                              onClick={() => handleIgnore(c)}
                              className="inline-flex items-center gap-1 rounded-md bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface hover:bg-surface-container-highest"
                              title="Rimuovi dalla lista"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-on-surface">
              Dipendenti collegati{" "}
              <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                {assignedEmployees.length}
              </span>
            </h2>
            {assignedEmployees.length === 0 ? (
              <div className="rounded-lg border border-dashed border-surface-container-high bg-surface-container-lowest p-6 text-center text-sm text-on-surface-variant">
                Nessun dipendente ha ancora un bot Telegram collegato.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg bg-surface-container-lowest shadow-card">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-container-low text-xs uppercase tracking-wide text-on-surface-variant">
                    <tr>
                      <th className="px-4 py-2">Dipendente</th>
                      <th className="px-4 py-2">Username</th>
                      <th className="px-4 py-2">Chat ID</th>
                      <th className="px-4 py-2 text-right">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignedEmployees.map((e) => {
                      const isEditing = !!editing[e.id];
                      return (
                        <tr key={e.id} className="border-b border-surface-container">
                          <td className="px-4 py-3 font-medium">{e.displayName || e.name}</td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editing[e.id].username}
                                onChange={(ev) =>
                                  setEditing((p) => ({ ...p, [e.id]: { ...p[e.id], username: ev.target.value } }))
                                }
                                placeholder="username (opzionale)"
                                className="w-40 rounded border-0 bg-surface-container-highest px-2 py-1 text-xs focus:ring-1 focus:ring-primary/20"
                              />
                            ) : (
                              e.telegramUsername ? `@${e.telegramUsername}` : <span className="text-on-surface-variant">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editing[e.id].chatId}
                                onChange={(ev) =>
                                  setEditing((p) => ({ ...p, [e.id]: { ...p[e.id], chatId: ev.target.value } }))
                                }
                                className="w-40 rounded border-0 bg-surface-container-highest px-2 py-1 text-xs focus:ring-1 focus:ring-primary/20"
                              />
                            ) : (
                              e.telegramChatId
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => saveEdit(e.id)}
                                    className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-on-primary hover:bg-primary/90"
                                  >
                                    Salva
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => cancelEdit(e.id)}
                                    className="rounded-md bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface hover:bg-surface-container-highest"
                                  >
                                    Annulla
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => startEdit(e)}
                                    className="rounded-md bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface hover:bg-surface-container-highest"
                                  >
                                    Modifica
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleUnlink(e.id)}
                                    className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                                    title="Scollega bot"
                                  >
                                    <Link2Off className="h-3 w-3" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
