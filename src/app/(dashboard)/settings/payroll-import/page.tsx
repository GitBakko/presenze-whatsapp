"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface DiffPair {
  currentRemaining: number;
  newRemaining: number;
  currentCarryOver: number;
  newCarryOver: number;
  currentAdjust: number;
  newAdjust: number;
}

interface PreviewRow {
  matricola: string;
  cognomePdf: string;
  nomePdf: string;
  matched: boolean;
  employeeId: string | null;
  employeeDisplayName: string | null;
  vacation: DiffPair;
  rol: DiffPair;
  warnings: string[];
}

interface PreviewResponse {
  year: number;
  sourceMonthLabel: string;
  fileHash: string;
  alreadyImported: { importId: string; createdAt: string } | null;
  rows: PreviewRow[];
  orphans: { employeeId: string; displayName: string }[];
}

interface AvailableEmployee {
  id: string;
  displayName: string;
}

export default function PayrollImportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [available, setAvailable] = useState<AvailableEmployee[]>([]);
  const [busy, setBusy] = useState(false);

  async function loadAvailableEmployees() {
    const res = await fetch("/api/employees?withoutPayrollId=1");
    if (res.ok) {
      const data = await res.json();
      setAvailable(
        (data as { id: string; displayName?: string; name: string }[]).map((e) => ({
          id: e.id,
          displayName: e.displayName ?? e.name,
        }))
      );
    }
  }

  async function runPreview(f: File) {
    setBusy(true);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/settings/payroll-import/preview", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Errore preview", { description: data.hint });
        return;
      }
      setPreview(data);
      await loadAvailableEmployees();
    } finally {
      setBusy(false);
    }
  }

  function handleFile(f: File | null) {
    setFile(f);
    if (f) void runPreview(f);
  }

  async function associate(matricola: string, employeeId: string) {
    if (!employeeId) return;
    const fd = new FormData();
    fd.append("payrollId", matricola);
    const res = await fetch(`/api/employees/${employeeId}`, { method: "PUT", body: fd });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Errore associazione");
      return;
    }
    toast.success(`Matricola ${matricola} associata`);
    if (file) await runPreview(file);
  }

  async function confirm() {
    if (!file || !preview) return;
    if (!confirmDialog(preview)) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("confirmHash", preview.fileHash);
      const res = await fetch("/api/settings/payroll-import/confirm", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Errore conferma");
        return;
      }
      toast.success(`Import completato: ${data.matched} dipendenti aggiornati`);
      router.push(`/settings/payroll-import/history/${data.importId}`);
    } finally {
      setBusy(false);
    }
  }

  function confirmDialog(p: PreviewResponse): boolean {
    if (p.alreadyImported) {
      return window.confirm(
        `Questo file è già stato importato il ${new Date(p.alreadyImported.createdAt).toLocaleString("it-IT")}. Procedere comunque?`
      );
    }
    return window.confirm(
      `Aggiornare i saldi ferie/ROL per ${p.rows.filter((r) => r.matched).length} dipendenti?`
    );
  }

  const unmatchedCount = preview?.rows.filter((r) => !r.matched).length ?? 0;
  const matchedCount = preview?.rows.filter((r) => r.matched).length ?? 0;
  const canConfirm = preview !== null && unmatchedCount === 0 && !busy;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Import tabulato paghe</h1>
        <a
          href="/settings/payroll-import/history"
          className="text-sm text-blue-600 hover:underline"
        >
          Storico import →
        </a>
      </div>

      <section className="bg-white rounded-lg border border-gray-200 p-4">
        <label className="block text-sm font-medium mb-2">
          File PDF tabulato (max 5MB)
        </label>
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          disabled={busy}
        />
      </section>

      {busy && <p className="text-gray-500">Elaborazione in corso…</p>}

      {preview && (
        <>
          <section className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="text-lg font-medium">
              Tabulato {preview.sourceMonthLabel} — {preview.rows.length} dipendenti nel PDF · {matchedCount} associati · {unmatchedCount} da associare
            </h2>
            {preview.alreadyImported && (
              <div className="mt-3 p-3 rounded-md bg-yellow-50 border border-yellow-200 text-sm">
                ⚠ Questo file è già stato importato il{" "}
                {new Date(preview.alreadyImported.createdAt).toLocaleString("it-IT")}.{" "}
                <a
                  href={`/settings/payroll-import/history/${preview.alreadyImported.importId}`}
                  className="underline"
                >
                  Vedi import precedente
                </a>
              </div>
            )}
            {preview.orphans.length > 0 && (
              <div className="mt-3 p-3 rounded-md bg-blue-50 border border-blue-200 text-sm">
                I seguenti dipendenti dell&apos;app non sono nel PDF e NON verranno toccati:{" "}
                {preview.orphans.map((o) => o.displayName).join(", ")}
              </div>
            )}
          </section>

          <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-3 py-2">Matr.</th>
                  <th className="px-3 py-2">PDF</th>
                  <th className="px-3 py-2">Dipendente</th>
                  <th className="px-3 py-2 text-right">Ferie (gg)</th>
                  <th className="px-3 py-2 text-right">ROL (h)</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr
                    key={r.matricola}
                    className={r.matched ? "border-t" : "border-t bg-red-50"}
                  >
                    <td className="px-3 py-2 font-mono">{r.matricola}</td>
                    <td className="px-3 py-2">
                      {r.cognomePdf} {r.nomePdf}
                    </td>
                    <td className="px-3 py-2">
                      {r.matched ? (
                        r.employeeDisplayName
                      ) : (
                        <select
                          className="border border-gray-300 rounded px-2 py-1"
                          defaultValue=""
                          onChange={(e) => associate(r.matricola, e.target.value)}
                        >
                          <option value="">— Associa a… —</option>
                          {available.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.displayName}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.matched ? <DiffCell pair={r.vacation} /> : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.matched ? <DiffCell pair={r.rol} /> : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {r.warnings.join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="flex justify-end">
            <button
              onClick={confirm}
              disabled={!canConfirm}
              className="px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-300"
            >
              Conferma import
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function DiffCell({ pair }: { pair: DiffPair }) {
  const diff = pair.newRemaining - pair.currentRemaining;
  const color =
    diff > 0.005
      ? "text-green-700"
      : diff < -0.005
      ? "text-red-700"
      : "text-gray-700";
  return (
    <span className="font-mono">
      {pair.currentRemaining.toFixed(2)} →{" "}
      <span className={`font-semibold ${color}`}>{pair.newRemaining.toFixed(2)}</span>
    </span>
  );
}
