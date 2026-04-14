"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Mail, Trash2, Link2, RefreshCw, PlayCircle } from "lucide-react";
import { useConfirm } from "@/components/ConfirmProvider";

interface Employee {
  id: string;
  name: string;
  displayName: string | null;
  email: string | null;
}

interface UnrecognizedEmail {
  id: string;
  fromAddress: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  attempts: number;
}

interface IngestLogItem {
  id: string;
  messageId: string;
  fromAddress: string;
  subject: string;
  status: string;
  errorDetail: string | null;
  leaveRequestId: string | null;
  processedAt: string;
}

function fmtDateTime(iso: string): string {
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

const STATUS_BADGE: Record<string, string> = {
  OK: "bg-emerald-100 text-emerald-900",
  UNKNOWN_SENDER: "bg-amber-100 text-amber-900",
  PARSE_ERROR: "bg-rose-100 text-rose-900",
  INTERNAL_ERROR: "bg-rose-200 text-rose-950",
  DUPLICATE: "bg-surface-container text-on-surface-variant",
};

export default function EmailIngestPage() {
  const confirm = useConfirm();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [unrecognized, setUnrecognized] = useState<UnrecognizedEmail[]>([]);
  const [logs, setLogs] = useState<IngestLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [pendingAssoc, setPendingAssoc] = useState<Record<string, string>>({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, unkRes, logRes] = await Promise.all([
        fetch("/api/employees"),
        fetch("/api/settings/unrecognized-email"),
        fetch("/api/settings/email-ingest-log"),
      ]);
      const emps: Employee[] = await empRes.json();
      const unks: UnrecognizedEmail[] = await unkRes.json();
      const lgs: IngestLogItem[] = await logRes.json();
      emps.sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name));
      setEmployees(emps);
      setUnrecognized(unks);
      setLogs(lgs);
    } catch {
      toast.error("Errore nel caricamento dei dati");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/settings/email-ingest-run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || `Errore ${res.status}`);
        return;
      }
      const s = data.stats || {};
      toast.success(`Ciclo completato: ${s.scanned ?? 0} scansionate, ${s.ok ?? 0} OK, ${s.unknownSender ?? 0} sconosciute, ${s.parseError ?? 0} errori`);
      loadAll();
    } catch {
      toast.error("Errore di rete");
    } finally {
      setRunning(false);
    }
  };

  const handleAssociate = async (item: UnrecognizedEmail) => {
    const empId = pendingAssoc[item.id];
    if (!empId) {
      toast.warning("Seleziona prima un dipendente");
      return;
    }
    try {
      const fd = new FormData();
      fd.append("email", item.fromAddress);
      const res = await fetch(`/api/employees/${empId}`, { method: "PUT", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || `Errore ${res.status}`);
        return;
      }
      await fetch(`/api/settings/unrecognized-email?id=${item.id}`, { method: "DELETE" });
      toast.success("Indirizzo associato");
      setPendingAssoc((p) => {
        const r = { ...p };
        delete r[item.id];
        return r;
      });
      loadAll();
    } catch {
      toast.error("Errore di rete");
    }
  };

  const handleIgnore = async (item: UnrecognizedEmail) => {
    const ok = await confirm({
      title: "Rimuovi mittente",
      message: `Eliminare ${item.fromAddress} dalla lista dei mittenti sconosciuti?`,
      confirmLabel: "Rimuovi",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/settings/unrecognized-email?id=${item.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Mittente rimosso");
      loadAll();
    } else {
      toast.error("Errore");
    }
  };

  const unassignedEmployees = employees.filter((e) => !e.email);

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
            <Mail className="h-7 w-7 text-violet-500" /> Richieste ferie via email
          </h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Le richieste con oggetto <code className="font-mono">ferie</code> e corpo <code className="font-mono">DAL ... AL ...</code> arrivate sulla casella IMAP configurata vengono ingerite automaticamente come richieste in attesa di approvazione.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={runNow}
            disabled={running}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-primary to-primary-container px-3 py-2 text-sm font-medium text-on-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PlayCircle className="h-4 w-4" /> {running ? "Elaboro…" : "Esegui ora"}
          </button>
          <button
            type="button"
            onClick={loadAll}
            className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container px-3 py-2 text-sm font-medium text-on-surface hover:bg-surface-container-high"
          >
            <RefreshCw className="h-4 w-4" /> Aggiorna
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900">
        <p>
          <strong>Come funziona:</strong> il dipendente invia un&apos;email con oggetto <code className="font-mono">ferie</code> dal suo indirizzo associato. Nel corpo scrive <code className="font-mono">DAL gg/mm AL gg/mm</code> (anno corrente) o <code className="font-mono">DAL gg/mm/aaaa AL gg/mm/aaaa</code>. Il sistema controlla la casella ogni 2 minuti, parsea, crea una richiesta in stato <em>In attesa</em> e risponde con conferma. Se il mittente non è riconosciuto o il formato è errato, viene loggato qui sotto e gli viene inviata una mail con la spiegazione.
        </p>
      </div>

      {loading && <div className="text-sm text-on-surface-variant">Caricamento…</div>}

      {!loading && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-on-surface">
              Mittenti sconosciuti{" "}
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                {unrecognized.length}
              </span>
            </h2>
            {unrecognized.length === 0 ? (
              <div className="rounded-lg border border-dashed border-surface-container-high bg-surface-container-lowest p-6 text-center text-sm text-on-surface-variant">
                Nessun mittente in attesa di associazione.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg bg-surface-container-lowest shadow-card">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-container-low text-xs uppercase tracking-wide text-on-surface-variant">
                    <tr>
                      <th className="px-4 py-2">Email</th>
                      <th className="px-4 py-2">Oggetto</th>
                      <th className="px-4 py-2">Anteprima</th>
                      <th className="px-4 py-2">Ultimo invio</th>
                      <th className="px-4 py-2 text-center">Tentativi</th>
                      <th className="px-4 py-2">Associa a</th>
                      <th className="px-4 py-2 text-right">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unrecognized.map((u) => (
                      <tr key={u.id} className="border-b border-surface-container">
                        <td className="px-4 py-3 font-mono text-xs">{u.fromAddress}</td>
                        <td className="px-4 py-3 text-xs">{u.subject}</td>
                        <td className="px-4 py-3 max-w-xs truncate text-xs text-on-surface-variant" title={u.snippet}>
                          {u.snippet}
                        </td>
                        <td className="px-4 py-3 text-xs">{fmtDateTime(u.receivedAt)}</td>
                        <td className="px-4 py-3 text-center">{u.attempts}</td>
                        <td className="px-4 py-3">
                          <select
                            value={pendingAssoc[u.id] || ""}
                            onChange={(e) => setPendingAssoc((p) => ({ ...p, [u.id]: e.target.value }))}
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
                              onClick={() => handleAssociate(u)}
                              disabled={!pendingAssoc[u.id]}
                              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-on-primary hover:bg-primary/90 disabled:opacity-40"
                            >
                              <Link2 className="h-3 w-3" /> Associa
                            </button>
                            <button
                              type="button"
                              onClick={() => handleIgnore(u)}
                              className="rounded-md bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface hover:bg-surface-container-highest"
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
              Storico ingest{" "}
              <span className="ml-2 rounded-full bg-surface-container px-2 py-0.5 text-xs font-medium text-on-surface-variant">
                {logs.length}
              </span>
            </h2>
            {logs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-surface-container-high bg-surface-container-lowest p-6 text-center text-sm text-on-surface-variant">
                Nessuna mail elaborata finora.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg bg-surface-container-lowest shadow-card">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-container-low text-xs uppercase tracking-wide text-on-surface-variant">
                    <tr>
                      <th className="px-4 py-2">Quando</th>
                      <th className="px-4 py-2">Mittente</th>
                      <th className="px-4 py-2">Oggetto</th>
                      <th className="px-4 py-2">Stato</th>
                      <th className="px-4 py-2">Dettaglio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l) => (
                      <tr key={l.id} className="border-b border-surface-container">
                        <td className="px-4 py-3 text-xs">{fmtDateTime(l.processedAt)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{l.fromAddress}</td>
                        <td className="px-4 py-3 text-xs">{l.subject}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[l.status] || "bg-surface-container"}`}>
                            {l.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-on-surface-variant max-w-xs truncate" title={l.errorDetail || ""}>
                          {l.errorDetail || (l.leaveRequestId ? `→ richiesta ${l.leaveRequestId.slice(0, 8)}…` : "")}
                        </td>
                      </tr>
                    ))}
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
