"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Nfc, Trash2, Link2, Link2Off, RefreshCw, AlertTriangle } from "lucide-react";
import { useConfirm } from "@/components/ConfirmProvider";

interface Employee {
  id: string;
  name: string;
  displayName: string | null;
  nfcUid: string | null;
}

interface UnrecognizedNfc {
  id: string;
  uid: string;
  firstSeenAt: string;
  lastSeenAt: string;
  attempts: number;
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("it-IT", {
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

export default function NfcSettingsPage() {
  const confirm = useConfirm();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [unrecognized, setUnrecognized] = useState<UnrecognizedNfc[]>([]);
  const [loading, setLoading] = useState(true);
  // Mappa: id UID non riconosciuto → employee selezionato per l'associazione
  const [pendingAssoc, setPendingAssoc] = useState<Record<string, string>>({});
  // Mappa: employee.id → nuovo UID in fase di edit (modal inline)
  const [editing, setEditing] = useState<Record<string, string>>({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, unkRes] = await Promise.all([
        fetch("/api/employees"),
        fetch("/api/settings/unrecognized-nfc"),
      ]);
      const emps: Employee[] = await empRes.json();
      const unks: UnrecognizedNfc[] = await unkRes.json();
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

  // ── Associa UID non riconosciuto a un dipendente ──────────────────────
  const handleAssociate = async (unkId: string, uid: string) => {
    const empId = pendingAssoc[unkId];
    if (!empId) {
      toast.warning("Seleziona prima un dipendente");
      return;
    }
    try {
      const fd = new FormData();
      fd.append("nfcUid", uid);
      const res = await fetch(`/api/employees/${empId}`, { method: "PUT", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || `Errore ${res.status}`);
        return;
      }
      // Rimuovi dalla lista non riconosciuti
      await fetch(`/api/settings/unrecognized-nfc?id=${unkId}`, { method: "DELETE" });
      toast.success("Tessera associata con successo");
      setPendingAssoc((p) => {
        const rest = { ...p };
        delete rest[unkId];
        return rest;
      });
      loadAll();
    } catch {
      toast.error("Errore di rete");
    }
  };

  // ── Ignora (cancella) un UID non riconosciuto ─────────────────────────
  const handleIgnore = async (unkId: string) => {
    const ok = await confirm({
      title: "Rimuovi UID",
      message: "Eliminare questo UID dalla lista? Se la tessera verrà passata di nuovo riapparirà.",
      confirmLabel: "Rimuovi",
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/settings/unrecognized-nfc?id=${unkId}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(`Errore ${res.status}`);
        return;
      }
      toast.success("UID rimosso dalla lista");
      loadAll();
    } catch {
      toast.error("Errore di rete");
    }
  };

  // ── Aggiorna/rimuovi UID di un dipendente già associato ───────────────
  const handleSaveEdit = async (empId: string, value: string) => {
    try {
      const fd = new FormData();
      fd.append("nfcUid", value);
      const res = await fetch(`/api/employees/${empId}`, { method: "PUT", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || `Errore ${res.status}`);
        return;
      }
      toast.success("Tessera aggiornata");
      setEditing((e) => {
        const rest = { ...e };
        delete rest[empId];
        return rest;
      });
      loadAll();
    } catch {
      toast.error("Errore di rete");
    }
  };

  const handleUnlink = async (empId: string) => {
    const ok = await confirm({
      title: "Scollega tessera",
      message: "Scollegare la tessera da questo dipendente?",
      confirmLabel: "Scollega",
      danger: true,
    });
    if (!ok) return;
    handleSaveEdit(empId, "");
  };

  // Dipendenti che NON hanno ancora una tessera (per popolare il <select>)
  const unassignedEmployees = employees.filter((e) => !e.nfcUid);
  const assignedEmployees = employees.filter((e) => !!e.nfcUid);

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
            <Nfc className="h-7 w-7 text-emerald-500" /> Postazione NFC
          </h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Associa i badge NFC ai dipendenti. Ogni tap registrato dal kiosk
            sull&apos;UID corrispondente diventa una timbratura automatica.
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

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">Usa badge Mifare 1K (o equivalenti) come tessera per il kiosk.</p>
            <p className="mt-1">
              <strong>La CIE 3.0, le CNS recenti, le carte bancarie contactless e gli smartphone NFC</strong> generano un
              UID casuale ad ogni lettura come misura di privacy (gli UID iniziano per <code className="font-mono">08</code>),
              quindi <strong>non possono essere usati come badge stabile</strong>: ogni tap risulterebbe come una tessera
              diversa. Acquista badge Mifare Classic 1K dedicati (pochi euro per lotti da 10-100) — l&apos;UID è fisso e
              immutabile, e funzionano da subito col kiosk senza modifiche.
            </p>
          </div>
        </div>
      </div>

      {loading && <div className="text-sm text-on-surface-variant">Caricamento…</div>}

      {!loading && (
        <>
          {/* ── Sezione 1: UID non riconosciuti ───────────────────────── */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-on-surface">
              Tessere non riconosciute{" "}
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                {unrecognized.length}
              </span>
            </h2>
            {unrecognized.length === 0 ? (
              <div className="rounded-lg border border-dashed border-surface-container-high bg-surface-container-lowest p-6 text-center text-sm text-on-surface-variant">
                Nessuna tessera in attesa di associazione. Quando un dipendente passa una
                tessera mai vista al kiosk, comparirà qui.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg bg-surface-container-lowest shadow-card">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-container-low text-xs uppercase tracking-wide text-on-surface-variant">
                    <tr>
                      <th className="px-4 py-2">UID</th>
                      <th className="px-4 py-2">Primo tap</th>
                      <th className="px-4 py-2">Ultimo tap</th>
                      <th className="px-4 py-2 text-center">Tentativi</th>
                      <th className="px-4 py-2">Associa a</th>
                      <th className="px-4 py-2 text-right">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unrecognized.map((u) => (
                      <tr key={u.id} className="border-b border-surface-container">
                        <td className="px-4 py-3 font-mono text-xs">{u.uid}</td>
                        <td className="px-4 py-3">{formatDateTime(u.firstSeenAt)}</td>
                        <td className="px-4 py-3">{formatDateTime(u.lastSeenAt)}</td>
                        <td className="px-4 py-3 text-center">{u.attempts}</td>
                        <td className="px-4 py-3">
                          <select
                            value={pendingAssoc[u.id] || ""}
                            onChange={(e) =>
                              setPendingAssoc((p) => ({ ...p, [u.id]: e.target.value }))
                            }
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
                              onClick={() => handleAssociate(u.id, u.uid)}
                              disabled={!pendingAssoc[u.id]}
                              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-on-primary hover:bg-primary/90 disabled:opacity-40"
                            >
                              <Link2 className="h-3 w-3" /> Associa
                            </button>
                            <button
                              type="button"
                              onClick={() => handleIgnore(u.id)}
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

          {/* ── Sezione 2: Dipendenti già associati ───────────────────── */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-on-surface">
              Dipendenti con tessera{" "}
              <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                {assignedEmployees.length}
              </span>
            </h2>
            {assignedEmployees.length === 0 ? (
              <div className="rounded-lg border border-dashed border-surface-container-high bg-surface-container-lowest p-6 text-center text-sm text-on-surface-variant">
                Nessun dipendente ha ancora una tessera associata.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg bg-surface-container-lowest shadow-card">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-container-low text-xs uppercase tracking-wide text-on-surface-variant">
                    <tr>
                      <th className="px-4 py-2">Dipendente</th>
                      <th className="px-4 py-2">UID associato</th>
                      <th className="px-4 py-2 text-right">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignedEmployees.map((e) => {
                      const isEditing = editing[e.id] !== undefined;
                      return (
                        <tr key={e.id} className="border-b border-surface-container">
                          <td className="px-4 py-3 font-medium">{e.displayName || e.name}</td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editing[e.id]}
                                onChange={(ev) =>
                                  setEditing((prev) => ({ ...prev, [e.id]: ev.target.value }))
                                }
                                placeholder="UID hex"
                                className="w-48 rounded border-0 bg-surface-container-highest px-2 py-1 font-mono text-xs focus:ring-1 focus:ring-primary/20"
                              />
                            ) : (
                              e.nfcUid
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEdit(e.id, editing[e.id])}
                                    className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-on-primary hover:bg-primary/90"
                                  >
                                    Salva
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditing((prev) => {
                                        const rest = { ...prev };
                                        delete rest[e.id];
                                        return rest;
                                      })
                                    }
                                    className="rounded-md bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface hover:bg-surface-container-highest"
                                  >
                                    Annulla
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditing((prev) => ({ ...prev, [e.id]: e.nfcUid || "" }))
                                    }
                                    className="rounded-md bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface hover:bg-surface-container-highest"
                                  >
                                    Modifica
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleUnlink(e.id)}
                                    className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                                    title="Scollega tessera"
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
