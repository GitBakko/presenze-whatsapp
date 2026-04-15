"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

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

export default function PayrollImportDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);

  useEffect(() => {
    fetch(`/api/settings/payroll-import/history/${params.id}`)
      .then((r) => r.json())
      .then(setData);
  }, [params.id]);

  if (!data) return <div className="p-6">Caricamento…</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <a href="/settings/payroll-import/history" className="text-sm text-blue-600 hover:underline">
        ← Storico
      </a>
      <h1 className="text-2xl font-semibold">{data.sourceMonth}</h1>
      <p className="text-gray-600 text-sm">
        Importato il {new Date(data.createdAt).toLocaleString("it-IT")} da {data.userName} · file{" "}
        <span className="font-mono">{data.fileName}</span>
      </p>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50 text-left">
          <tr>
            <th className="px-3 py-2">Matr.</th>
            <th className="px-3 py-2">Dipendente</th>
            <th className="px-3 py-2 text-right">Ferie carry (prima → dopo)</th>
            <th className="px-3 py-2 text-right">Ferie adjust</th>
            <th className="px-3 py-2 text-right">ROL carry</th>
            <th className="px-3 py-2 text-right">ROL adjust</th>
          </tr>
        </thead>
        <tbody>
          {data.payload.rows.map((r) => (
            <tr key={r.matricola} className="border-t">
              <td className="px-3 py-2 font-mono">{r.matricola}</td>
              <td className="px-3 py-2">
                {r.cognomePdf} {r.nomePdf}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {r.before.vacationCarryOver.toFixed(2)} → <strong>{r.after.vacationCarryOver.toFixed(2)}</strong>
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {r.before.vacationAccrualAdjust.toFixed(2)} → <strong>{r.after.vacationAccrualAdjust.toFixed(2)}</strong>
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {r.before.rolCarryOver.toFixed(2)} → <strong>{r.after.rolCarryOver.toFixed(2)}</strong>
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {r.before.rolAccrualAdjust.toFixed(2)} → <strong>{r.after.rolAccrualAdjust.toFixed(2)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.payload.orphans.length > 0 && (
        <section className="text-sm">
          <h3 className="font-medium mb-1">Dipendenti non presenti nel PDF (non toccati):</h3>
          <p className="text-gray-700">
            {data.payload.orphans.map((o) => o.displayName).join(", ")}
          </p>
        </section>
      )}
    </div>
  );
}
