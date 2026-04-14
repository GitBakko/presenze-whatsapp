"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface ExcludedName {
  id: string;
  name: string;
}

export default function ExcludedNamesPage() {
  const [names, setNames] = useState<ExcludedName[]>([]);
  const [loading, setLoading] = useState(true);
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
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/excluded-names?id=${id}`, { method: "DELETE" });
    load();
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
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="Nome da escludere..."
          className="flex-1 rounded-lg border-0 bg-surface-container-highest px-3 py-2 text-sm text-on-surface shadow-sm focus:outline-none focus:ring-1 focus:ring-primary/20"
        />
        <button
          onClick={handleAdd}
          className="rounded-lg bg-gradient-to-br from-primary to-primary-container px-4 py-2 text-sm font-medium text-on-primary hover:shadow-elevated"
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
                  onClick={() => handleDelete(n.id)}
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
