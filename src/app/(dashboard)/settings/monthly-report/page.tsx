"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { FileSpreadsheet } from "lucide-react";
import { useConfirm } from "@/components/ConfirmProvider";

export default function MonthlyReportSettingsPage() {
  const confirm = useConfirm();
  const [day, setDay] = useState(5);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetch("/api/settings/monthly-report")
      .then((r) => r.json())
      .then((data: { day: number; enabled: boolean }) => {
        setDay(data.day);
        setEnabled(data.enabled);
      })
      .catch(() => toast.error("Errore caricamento configurazione"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    const res = await fetch("/api/settings/monthly-report", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day, enabled }),
    });
    if (res.ok) toast.success("Configurazione salvata");
    else toast.error("Errore nel salvataggio");
  }

  async function handleSendNow() {
    const ok = await confirm({
      title: "Invia report ora",
      message:
        "Genera e invia il foglio presenze del mese precedente a tutti gli amministratori abilitati. Procedere?",
      confirmLabel: "Invia ora",
    });
    if (!ok) return;
    setSending(true);
    try {
      const res = await fetch("/api/settings/monthly-report/send-now", {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) toast.success(`Report inviato a ${data.sentTo} amministratori`);
      else toast.error(data.error ?? "Errore invio report");
    } finally {
      setSending(false);
    }
  }

  if (loading)
    return <p className="p-6 text-sm text-on-surface-variant">Caricamento…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/settings"
          className="text-sm text-primary hover:text-primary-container"
        >
          ← Impostazioni
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <FileSpreadsheet className="h-7 w-7 text-primary" strokeWidth={1.5} />
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-primary">
          Report automatico presenze
        </h1>
      </div>
      <p className="text-sm text-on-surface-variant">
        Invia automaticamente il foglio presenze del mese precedente agli
        amministratori abilitati, il giorno scelto di ogni mese.
      </p>

      <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-card space-y-4">
        <div className="flex items-center justify-between">
          <label
            htmlFor="enabled"
            className="text-sm font-semibold text-on-surface"
          >
            Invio automatico attivo
          </label>
          <input
            id="enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-5 w-5 rounded border-outline-variant text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        </div>
        <div>
          <label
            htmlFor="day"
            className="block text-sm font-semibold text-on-surface mb-1"
          >
            Giorno del mese
          </label>
          <input
            id="day"
            type="number"
            min={1}
            max={28}
            value={day}
            onChange={(e) =>
              setDay(Math.max(1, Math.min(28, parseInt(e.target.value) || 1)))
            }
            className="w-24 rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <p className="mt-1 text-xs text-on-surface-variant">
            Il report del mese precedente verrà generato e inviato il giorno
            indicato.
          </p>
        </div>
        <button
          onClick={handleSave}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-primary hover:bg-primary-container shadow-card transition-shadow hover:shadow-elevated"
        >
          Salva
        </button>
      </div>

      <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-card space-y-3">
        <h3 className="text-sm font-semibold text-on-surface">Test invio</h3>
        <p className="text-xs text-on-surface-variant">
          Genera e invia il report del mese precedente a tutti gli admin
          abilitati. Utile per verificare che email e allegato funzionino
          correttamente.
        </p>
        <button
          onClick={handleSendNow}
          disabled={sending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-primary hover:bg-primary-container shadow-card transition-shadow hover:shadow-elevated disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "Invio in corso…" : "Invia ora"}
        </button>
      </div>
    </div>
  );
}
