"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  FileSpreadsheet,
  FileText,
  Info,
  Upload,
} from "lucide-react";
import { useConfirm } from "@/components/ConfirmProvider";

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
  const confirm = useConfirm();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [available, setAvailable] = useState<AvailableEmployee[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function loadAvailableEmployees() {
    const res = await fetch("/api/employees?withoutPayrollId=1");
    if (res.ok) {
      const data = await res.json();
      setAvailable(
        (data as { id: string; displayName?: string; name: string }[]).map(
          (e) => ({ id: e.id, displayName: e.displayName ?? e.name })
        )
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

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (!f) return;
      if (!f.name.toLowerCase().endsWith(".pdf")) {
        toast.error("Il file deve essere un PDF");
        return;
      }
      handleFile(f);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  async function associate(matricola: string, employeeId: string) {
    if (!employeeId) return;
    const fd = new FormData();
    fd.append("payrollId", matricola);
    const res = await fetch(`/api/employees/${employeeId}`, {
      method: "PUT",
      body: fd,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Errore associazione");
      return;
    }
    toast.success(`Matricola ${matricola} associata`);
    if (file) await runPreview(file);
  }

  async function handleConfirm() {
    if (!file || !preview) return;

    let ok: boolean;
    if (preview.alreadyImported) {
      ok = await confirm({
        title: "File già importato",
        message: (
          <>
            Questo tabulato è già stato importato il{" "}
            <strong>
              {new Date(preview.alreadyImported.createdAt).toLocaleString(
                "it-IT"
              )}
            </strong>
            . Procedere comunque con un nuovo import?
          </>
        ),
        confirmLabel: "Re-importa",
        danger: true,
      });
    } else {
      const n = preview.rows.filter((r) => r.matched).length;
      ok = await confirm({
        title: "Conferma import",
        message: (
          <>
            Verranno aggiornati i saldi ferie e ROL di{" "}
            <strong>{n} dipendenti</strong> per l&apos;anno{" "}
            <strong>{preview.year}</strong>. L&apos;operazione è tracciata
            nello storico e reversibile solo tramite nuovo import o modifica
            manuale dei saldi.
          </>
        ),
        confirmLabel: "Conferma import",
      });
    }
    if (!ok) return;

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
      toast.success(
        `Import completato: ${data.matched} dipendenti aggiornati`
      );
      router.push(`/settings/payroll-import/history/${data.importId}`);
    } finally {
      setBusy(false);
    }
  }

  const unmatchedCount = preview?.rows.filter((r) => !r.matched).length ?? 0;
  const matchedCount = preview?.rows.filter((r) => r.matched).length ?? 0;
  const canConfirm = preview !== null && unmatchedCount === 0 && !busy;

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

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <FileSpreadsheet
            className="h-7 w-7 text-primary"
            strokeWidth={1.5}
          />
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-primary">
            Import tabulato paghe
          </h1>
        </div>
        <Link
          href="/settings/payroll-import/history"
          className="text-sm font-semibold text-primary hover:text-primary-container"
        >
          Storico import →
        </Link>
      </div>
      <p className="text-sm text-on-surface-variant">
        Importa il tabulato mensile di ferie, festività soppresse e permessi
        dal consulente paghe per riallineare automaticamente i saldi in
        piattaforma. I valori del PDF diventano la fonte di verità per i
        residui.
      </p>

      {/* Dropzone */}
      <section className="space-y-3">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
            busy
              ? "border-outline-variant bg-surface-container-low opacity-60"
              : dragOver
              ? "border-primary bg-primary-fixed/10"
              : "border-outline-variant bg-surface-container-low hover:border-outline hover:bg-surface-container"
          }`}
        >
          <Upload
            className="mb-3 h-12 w-12 text-primary"
            strokeWidth={1.5}
          />
          <p className="text-base font-medium text-on-surface">
            Trascina qui il tabulato PDF del consulente paghe
          </p>
          <p className="mt-1 text-xs text-on-surface-variant">oppure</p>
          <label className="mt-3 cursor-pointer rounded-lg bg-surface-container-lowest px-4 py-2 text-sm font-medium text-primary shadow-card transition-shadow hover:shadow-elevated focus-within:ring-2 focus-within:ring-primary/30">
            Sfoglia file
            <input
              type="file"
              accept="application/pdf,.pdf"
              aria-label="Seleziona tabulato PDF"
              onChange={(e) =>
                handleFile(e.target.files?.[0] ?? null)
              }
              disabled={busy}
              className="hidden"
            />
          </label>
          <p className="mt-4 text-xs text-on-surface-variant">
            Formato PDF · dimensione massima 5&nbsp;MB
          </p>
        </div>

        {file && (
          <div className="flex items-center gap-3 rounded-xl border border-outline-variant/30 bg-white px-4 py-3 shadow-sm">
            <FileText
              className="h-5 w-5 shrink-0 text-primary"
              strokeWidth={1.5}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-on-surface">
                {file.name}
              </p>
              <p className="text-xs text-on-surface-variant">
                {(file.size / 1024).toFixed(1)} KB
                {preview && ` · ${preview.sourceMonthLabel}`}
              </p>
            </div>
            {busy && (
              <span className="text-xs font-medium text-on-surface-variant">
                Elaborazione…
              </span>
            )}
          </div>
        )}
      </section>

      {/* Preview */}
      {preview && (
        <>
          <section className="space-y-3">
            <div className="rounded-xl border border-outline-variant/30 bg-white p-4 shadow-sm">
              <h2 className="font-display text-base font-bold text-on-surface">
                Tabulato {preview.sourceMonthLabel}
              </h2>
              <p className="mt-1 text-sm text-on-surface-variant">
                {preview.rows.length} dipendenti nel PDF ·{" "}
                <span className="font-semibold text-on-surface">
                  {matchedCount} associati
                </span>{" "}
                ·{" "}
                <span
                  className={
                    unmatchedCount > 0
                      ? "font-semibold text-rose-700"
                      : "text-on-surface-variant"
                  }
                >
                  {unmatchedCount} da associare
                </span>
              </p>
            </div>

            {preview.alreadyImported && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <AlertTriangle
                  className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
                  strokeWidth={1.5}
                />
                <div className="flex-1 text-sm text-amber-900">
                  <p className="font-semibold">File già importato</p>
                  <p className="mt-1">
                    Questo tabulato è già stato importato il{" "}
                    {new Date(
                      preview.alreadyImported.createdAt
                    ).toLocaleString("it-IT")}
                    .{" "}
                    <Link
                      href={`/settings/payroll-import/history/${preview.alreadyImported.importId}`}
                      className="font-semibold underline hover:no-underline"
                    >
                      Vedi import precedente
                    </Link>
                  </p>
                </div>
              </div>
            )}

            {preview.orphans.length > 0 && (
              <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4">
                <Info
                  className="mt-0.5 h-5 w-5 shrink-0 text-sky-600"
                  strokeWidth={1.5}
                />
                <div className="flex-1 text-sm text-sky-900">
                  <p className="font-semibold">
                    Dipendenti non presenti nel PDF
                  </p>
                  <p className="mt-1">
                    I saldi di{" "}
                    <strong>
                      {preview.orphans
                        .map((o) => o.displayName)
                        .join(", ")}
                    </strong>{" "}
                    non verranno modificati.
                  </p>
                </div>
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-outline-variant/30 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-surface-container bg-surface-container-low/50">
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">
                    Matr.
                  </th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">
                    Dipendente PDF
                  </th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">
                    Dipendente app
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-outline-variant">
                    Ferie (gg)
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-outline-variant">
                    ROL (h)
                  </th>
                  <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">
                    Note
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {preview.rows.map((r) => (
                  <tr
                    key={r.matricola}
                    className={
                      r.matched
                        ? "transition-colors hover:bg-surface-container-low/50"
                        : "bg-rose-50/60 transition-colors hover:bg-rose-50"
                    }
                  >
                    <td className="px-4 py-3 font-mono text-on-surface-variant">
                      {r.matricola}
                    </td>
                    <td className="px-4 py-3 font-semibold text-on-surface">
                      {r.cognomePdf} {r.nomePdf}
                    </td>
                    <td className="px-4 py-3">
                      {r.matched ? (
                        <span className="text-on-surface">
                          {r.employeeDisplayName}
                        </span>
                      ) : (
                        <select
                          aria-label={`Associa matricola ${r.matricola}`}
                          className="rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                          defaultValue=""
                          onChange={(e) =>
                            associate(r.matricola, e.target.value)
                          }
                          disabled={busy}
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
                    <td className="px-4 py-3 text-right">
                      {r.matched ? <DiffCell pair={r.vacation} /> : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.matched ? <DiffCell pair={r.rol} /> : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-on-surface-variant">
                      {r.warnings.join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-on-surface-variant">
              {unmatchedCount > 0
                ? `Associa le ${unmatchedCount} matricole mancanti per abilitare la conferma.`
                : "Tutte le matricole sono associate, pronto per la conferma."}
            </p>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="rounded-lg bg-gradient-to-br from-primary to-primary-container px-5 py-2 text-sm font-bold text-on-primary shadow-card transition-shadow hover:shadow-elevated disabled:cursor-not-allowed disabled:opacity-50"
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
    Math.abs(diff) < 0.005
      ? "text-on-surface"
      : diff > 0
      ? "text-emerald-700"
      : "text-rose-700";
  return (
    <span className="font-mono">
      <span className="text-on-surface-variant">
        {pair.currentRemaining.toFixed(2)}
      </span>
      <span className="mx-1 text-outline-variant">→</span>
      <span className={`font-semibold ${color}`}>
        {pair.newRemaining.toFixed(2)}
      </span>
    </span>
  );
}
