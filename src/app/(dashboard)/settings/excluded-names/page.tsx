"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmProvider";

interface ExcludedName {
  id: string;
  name: string;
}

export default function ExcludedNamesPage() {
  const confirm = useConfirm();
  const [names, setNames] = useState<ExcludedName[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/excluded-names")
      .then((r) => r.json())
      .then(setNames)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    setError("");
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/excluded-names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Errore");
        return;
      }
      setNewName("");
      load();
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: "Elimina nome escluso",
      message: `Eliminare "${name}" dalla lista?`,
      confirmLabel: "Elimina",
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/excluded-names?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Errore durante l'eliminazione");
        return;
      }
      load();
    } catch {
      toast.error("Errore di rete");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/settings" className="text-primary hover:text-primary-container text-sm">
          ← Impostazioni
        </Link>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-primary">Nomi Esclusi</h1>
      </div>

      <p className="text-sm text-on-surface-variant">
        I messaggi inviati da questi nomi verranno ignorati durante il parsing.
        Utile per escludere admin, bot o partner esterni.
      </p>

      <div className="flex items-center gap-3">
        <label className="sr-only" htmlFor="excluded-name-input">Nome da escludere</label>
        <input
          id="excluded-name-input"
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="Nome da escludere..."
          className="flex-1 rounded-lg border-0 bg-surface-container-highest px-3 py-2 text-sm text-on-surface shadow-sm focus:outline-none focus:ring-1 focus:ring-primary/20"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || !newName.trim()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:bg-primary-container disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Aggiungi
        </button>
      </div>

      {error && (
        <div className="rounded-lg border-0 bg-error-container px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center text-outline-variant">
          Caricamento...
        </div>
      ) : names.length === 0 ? (
        <div className="rounded-lg bg-surface-container-lowest shadow-card p-8 text-center text-outline-variant">
          Nessun nome escluso configurato.
        </div>
      ) : (
        <div className="rounded-lg bg-surface-container-lowest shadow-card">
          <ul className="divide-y divide-surface-container">
            {names.map((n) => (
              <li key={n.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium text-on-surface">{n.name}</span>
                <button
                  type="button"
                  onClick={() => handleDelete(n.id, n.name)}
                  className="rounded bg-error-container px-2.5 py-1 text-xs font-medium text-error hover:bg-error-container/80"
                >
                  Rimuovi
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
