"use client";

import { useState } from "react";
import { FileUpload } from "@/components/FileUpload";
import { Inbox, CheckCircle, SkipForward, AlertTriangle } from "lucide-react";

interface ImportResult {
  imported: number;
  skipped: number;
  total: number;
  errors: string[];
}

export default function ImportPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  const handleUpload = async (file: File) => {
    setLoading(true);
    setResult(null);
    setError("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/import/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Errore durante l'importazione");
        return;
      }

      const data: ImportResult = await res.json();
      setResult(data);
    } catch {
      setError("Errore di rete");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-extrabold tracking-tight text-primary">Importa Dati</h1>

      <div className="max-w-xl">
        <p className="mb-4 text-sm text-on-surface-variant">
          Esporta la chat di gruppo WhatsApp come file .txt e caricalo qui. I
          messaggi di entrata e uscita verranno estratti automaticamente.
        </p>

        <FileUpload onUpload={handleUpload} isLoading={loading} />

        {result && (
          <div className="mt-4 rounded-lg bg-success-container/30 shadow-card p-4">
            <h3 className="font-semibold text-success">
              Importazione completata
            </h3>
            <div className="mt-2 space-y-1 text-sm text-success">
              <p className="flex items-center gap-1.5"><Inbox className="h-4 w-4 text-blue-500" /> Totale messaggi presenze trovati: {result.total}</p>
              <p className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-emerald-500" /> Record importati: {result.imported}</p>
              <p className="flex items-center gap-1.5"><SkipForward className="h-4 w-4 text-outline-variant" /> Record già esistenti (saltati): {result.skipped}</p>
              {result.errors.length > 0 && (
                <div className="mt-2">
                  <p className="font-medium text-warning flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 text-amber-500" /> Errori ({result.errors.length}):
                  </p>
                  <ul className="mt-1 list-inside list-disc text-xs text-warning">
                    {result.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg bg-error-container/30 shadow-card p-4 text-sm text-error">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
