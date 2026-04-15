"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { KeyRound, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmProvider";
import { InfoBanner } from "@/components/InfoBanner";
import { StatusBadge } from "@/components/StatusBadge";

interface ApiKeyItem {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
}

export default function ApiKeysPage() {
  const confirm = useConfirm();
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchKeys = useCallback(async () => {
    const res = await fetch("/api/settings/api-keys");
    if (res.ok) setKeys(await res.json());
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewKey(data.key);
        setName("");
        fetchKeys();
      } else {
        toast.error(data.error ?? "Errore nella creazione");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Elimina chiave API",
      message: "Eliminare questa chiave API? Le applicazioni che la usano perderanno l'accesso.",
      confirmLabel: "Elimina",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/settings/api-keys?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Chiave API eliminata");
    } else {
      toast.error("Errore nella cancellazione");
    }
    fetchKeys();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/settings" className="text-sm text-primary hover:text-primary-container">← Impostazioni</Link>
      </div>

      <h1 className="font-display text-2xl font-extrabold tracking-tight text-primary">Chiavi API</h1>
      <p className="text-sm text-on-surface-variant">
        Le chiavi API permettono ad applicazioni esterne di inviare richieste di ferie/permessi.
        Le richieste arrivano con stato &quot;In attesa&quot; e devono essere approvate da un admin.
      </p>

      {/* Create form */}
      <form onSubmit={handleCreate} className="flex gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome applicazione (es. App Dipendenti)"
          className="flex-1 rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-primary shadow-sm transition-all hover:bg-primary-container disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Genera chiave
        </button>
      </form>

      {/* New key display */}
      {newKey && (
        <InfoBanner kind="success" title="Chiave generata — copiala ora, non sarà più visibile!">
          <code className="mt-2 block break-all rounded bg-surface-container-low px-3 py-2 font-mono text-xs select-all">
            {newKey}
          </code>
          <button
            onClick={() => setNewKey(null)}
            className="mt-2 text-xs font-semibold hover:underline"
          >
            Ho copiato, chiudi
          </button>
        </InfoBanner>
      )}

      {/* Keys list */}
      {keys.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-outline-variant/30 bg-surface-container-lowest py-12 text-center">
          <KeyRound className="mb-3 h-12 w-12 text-outline-variant" />
          <p className="text-sm text-on-surface-variant">Nessuna chiave API creata</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-lowest shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-surface-container bg-surface-container-low/50">
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">Nome</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">Creata il</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">Stato</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {keys.map((k) => (
                <tr key={k.id} className="transition-colors hover:bg-surface-container-low/50">
                  <td className="px-4 py-3 font-semibold text-on-surface">{k.name}</td>
                  <td className="px-4 py-3 text-xs text-on-surface-variant">
                    {new Date(k.createdAt).toLocaleDateString("it-IT")}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge kind={k.active ? "success" : "error"}>
                      {k.active ? "Attiva" : "Disattivata"}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(k.id)}
                      aria-label="Elimina chiave"
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg p-1 text-outline-variant hover:bg-red-50 hover:text-red-500"
                      title="Elimina"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* API usage docs */}
      <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-card">
        <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wider text-primary">Documentazione API</h3>
        <div className="space-y-3 text-xs text-on-surface-variant">
          <p><strong>Endpoint:</strong> <code className="rounded bg-surface-container-high px-1.5 py-0.5 font-mono">POST /api/external/leaves</code></p>
          <p><strong>Autenticazione:</strong> Header <code className="rounded bg-surface-container-high px-1.5 py-0.5 font-mono">Authorization: Bearer &lt;API_KEY&gt;</code></p>
          <p><strong>Body (JSON):</strong></p>
          <pre className="rounded-lg bg-surface-container-low p-3 font-mono text-[11px] leading-relaxed">{`{
  "employeeName": "Mario Rossi",
  "type": "VACATION",
  "startDate": "2025-01-20",
  "endDate": "2025-01-24",
  "notes": "Vacanza invernale"
}`}</pre>
          <p><strong>Tipi disponibili:</strong> VACATION, VACATION_HALF_AM, VACATION_HALF_PM, ROL, SICK, BEREAVEMENT, MARRIAGE, LAW_104, MEDICAL_VISIT</p>
        </div>
      </div>
    </div>
  );
}
