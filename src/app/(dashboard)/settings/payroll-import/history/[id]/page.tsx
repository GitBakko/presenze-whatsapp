"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { InfoBanner } from "@/components/InfoBanner";

interface Snapshot {
  vacationCarryOver: number;
  vacationAccrualAdjust: number;
  rolCarryOver: number;
  rolAccrualAdjust: number;
}
interface PdfCat {
  resAP: number;
  maturato: number;
  goduto: number;
  residuo: number;
}
interface Row {
  matricola: string;
  cognomePdf: string;
  nomePdf: string;
  employeeId: string;
  before: Snapshot;
  after: Snapshot;
  pdfValues: { fer: PdfCat; fes: PdfCat; per: PdfCat };
  warnings: string[];
}
interface Detail {
  id: string;
  createdAt: string;
  userName: string;
  fileName: string;
  year: number;
  sourceMonth: string;
  totalEmployees: number;
  matchedEmployees: number;
  orphanEmployees: number;
  payload: { rows: Row[]; orphans: { employeeId: string; displayName: string }[] };
}

function DiffNumber({ before, after }: { before: number; after: number }) {
  const delta = after - before;
  const color =
    Math.abs(delta) < 0.005
      ? "text-on-surface"
      : delta > 0
      ? "text-emerald-700"
      : "text-rose-700";
  return (
    <span className="font-mono">
      <span className="text-on-surface-variant">{before.toFixed(2)}</span>
      <span className="mx-1 text-outline-variant">→</span>
      <span className={`font-semibold ${color}`}>{after.toFixed(2)}</span>
    </span>
  );
}

export default function PayrollImportDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/settings/payroll-import/history/${params.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return <p className="text-sm text-on-surface-variant">Caricamento…</p>;
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <Link
          href="/settings/payroll-import/history"
          className="text-sm text-primary hover:text-primary-container"
        >
          ← Storico
        </Link>
        <InfoBanner kind="error" title="Import non trovato">
          Torna allo storico per la lista completa.
        </InfoBanner>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/settings/payroll-import/history"
          className="text-sm text-primary hover:text-primary-container"
        >
          ← Storico
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <FileSpreadsheet className="h-7 w-7 text-primary" strokeWidth={1.5} />
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-primary">
          {data.sourceMonth}
        </h1>
      </div>

      <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-4 shadow-card">
        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-outline-variant">
              Importato il
            </div>
            <div className="mt-1 text-on-surface">
              {new Date(data.createdAt).toLocaleString("it-IT")}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-outline-variant">
              Utente
            </div>
            <div className="mt-1 text-on-surface">{data.userName}</div>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-outline-variant">
              Dipendenti
            </div>
            <div className="mt-1 font-mono text-on-surface">
              {data.matchedEmployees}/{data.totalEmployees}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-outline-variant">
              File
            </div>
            <div className="mt-1 font-mono text-xs text-on-surface-variant">
              {data.fileName}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-lowest shadow-card">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-surface-container bg-surface-container-low/50">
              <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">
                Matr.
              </th>
              <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">
                Dipendente
              </th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-outline-variant">
                Ferie carry (gg)
              </th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-outline-variant">
                Ferie adjust
              </th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-outline-variant">
                ROL carry (h)
              </th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-outline-variant">
                ROL adjust
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container-low">
            {data.payload.rows.map((r) => (
              <tr
                key={r.matricola}
                className="transition-colors hover:bg-surface-container-low/50"
              >
                <td className="px-4 py-3 font-mono text-on-surface-variant">
                  {r.matricola}
                </td>
                <td className="px-4 py-3 font-semibold text-on-surface">
                  {r.cognomePdf} {r.nomePdf}
                </td>
                <td className="px-4 py-3 text-right">
                  <DiffNumber
                    before={r.before.vacationCarryOver}
                    after={r.after.vacationCarryOver}
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <DiffNumber
                    before={r.before.vacationAccrualAdjust}
                    after={r.after.vacationAccrualAdjust}
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <DiffNumber
                    before={r.before.rolCarryOver}
                    after={r.after.rolCarryOver}
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <DiffNumber
                    before={r.before.rolAccrualAdjust}
                    after={r.after.rolAccrualAdjust}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.payload.orphans.length > 0 && (
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-card">
          <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wider text-primary">
            Dipendenti non presenti nel PDF
          </h3>
          <p className="text-xs text-on-surface-variant">
            I saldi di questi dipendenti non sono stati modificati da
            quest&apos;import.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.payload.orphans.map((o) => (
              <span
                key={o.employeeId}
                className="inline-block rounded-full bg-surface-container-high px-3 py-1 text-xs font-medium text-on-surface"
              >
                {o.displayName}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
