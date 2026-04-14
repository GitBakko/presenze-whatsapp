"use client";

import { useState } from "react";
import Link from "next/link";
import type { ByEmployeeCard, ByEmployeeRequest } from "./types";
import { TYPE_COLORS, STATUS_COLORS, STATUS_LABELS } from "./types";
import { BalanceMini } from "./BalanceCard";

export function ByEmployeeView({
  loading,
  cards,
  onRefresh,
}: {
  loading: boolean;
  cards: ByEmployeeCard[];
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = cards.filter((c) =>
    !query.trim() ||
    c.displayName.toLowerCase().includes(query.toLowerCase().trim())
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-on-surface-variant">
        Caricamento…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtra per nome dipendente…"
          className="flex-1 rounded-lg border-0 bg-surface-container-highest px-3 py-2 text-sm text-on-surface focus:ring-1 focus:ring-primary/20"
        />
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-lg bg-surface-container px-3 py-2 text-sm font-medium text-on-surface hover:bg-surface-container-high"
        >
          Aggiorna
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-surface-container-high bg-surface-container-lowest p-8 text-center text-sm text-on-surface-variant">
          {query ? "Nessun dipendente corrisponde al filtro." : "Nessun dipendente."}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((card) => (
            <ByEmployeeCardView key={card.id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}

function ByEmployeeCardView({ card }: { card: ByEmployeeCard }) {
  const initials = card.displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const counts = {
    APPROVED: card.requests.filter((r) => r.status === "APPROVED").length,
    PENDING: card.requests.filter((r) => r.status === "PENDING").length,
    REJECTED: card.requests.filter((r) => r.status === "REJECTED").length,
  };

  const formatPeriod = (r: ByEmployeeRequest) =>
    r.startDate === r.endDate ? r.startDate : `${r.startDate} → ${r.endDate}`;

  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant/30 bg-white shadow-sm">
      {/* Header card */}
      <div className="flex items-center justify-between border-b border-surface-container px-5 py-4">
        <div className="flex items-center gap-3">
          {card.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.avatarUrl}
              alt={card.displayName}
              className="h-10 w-10 rounded-full object-cover ring-2 ring-surface-container-lowest"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-container text-sm font-bold text-on-primary ring-2 ring-surface-container-lowest">
              {initials}
            </div>
          )}
          <div>
            <Link
              href={`/employees/${card.id}/edit`}
              className="font-semibold text-on-surface hover:text-primary hover:underline"
            >
              {card.displayName}
            </Link>
            {card.balance && (
              <div className="text-xs text-on-surface-variant">
                {card.balance.contractType === "FULL_TIME" ? "Full-time" : "Part-time"} ·{" "}
                {card.balance.weeklyHours}h/sett
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {counts.APPROVED > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-800">
              {counts.APPROVED} approvate
            </span>
          )}
          {counts.PENDING > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 font-semibold text-yellow-800">
              {counts.PENDING} in attesa
            </span>
          )}
          {counts.REJECTED > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-800">
              {counts.REJECTED} rifiutate
            </span>
          )}
        </div>
      </div>

      {/* Saldi mini-grid */}
      {card.balance ? (
        <div className="grid grid-cols-2 gap-3 border-b border-surface-container bg-surface-container-low/30 px-5 py-3 sm:grid-cols-4">
          <BalanceMini
            label="Ferie residue"
            value={`${card.balance.vacationRemaining} gg`}
            sub={`Mat ${card.balance.vacationAccrued} · Rip ${card.balance.vacationCarryOver} · Usa ${card.balance.vacationUsed}`}
            adjust={card.balance.vacationAccrualAdjust}
            negative={card.balance.vacationRemaining < 0}
            color="blue"
          />
          <BalanceMini
            label="ROL residui"
            value={`${card.balance.rolRemaining} h`}
            sub={`Mat ${card.balance.rolAccrued} · Rip ${card.balance.rolCarryOver} · Usa ${card.balance.rolUsed}`}
            adjust={card.balance.rolAccrualAdjust}
            negative={card.balance.rolRemaining < 0}
            color="amber"
          />
          <BalanceMini
            label="Malattia"
            value={`${card.balance.sickDays} gg`}
            sub="Senza limite"
            color="red"
          />
          <BalanceMini
            label="Richieste anno"
            value={`${card.requests.length}`}
            sub="totali"
            color="teal"
          />
        </div>
      ) : (
        <div className="border-b border-surface-container bg-surface-container-low/30 px-5 py-3 text-xs text-on-surface-variant">
          Saldo non calcolabile (manca lo schedule del dipendente).
        </div>
      )}

      {/* Lista richieste */}
      {card.requests.length === 0 ? (
        <div className="px-5 py-4 text-center text-xs text-on-surface-variant">
          Nessuna richiesta per quest&apos;anno.
        </div>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-surface-container bg-surface-container-low/20">
              <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Tipo</th>
              <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Periodo</th>
              <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Ore</th>
              <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Stato</th>
              <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Origine</th>
              <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Note</th>
            </tr>
          </thead>
          <tbody>
            {card.requests.map((r) => (
              <tr key={r.id} className="border-b border-surface-container last:border-0">
                <td className="px-4 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${TYPE_COLORS[r.type] ?? "bg-surface-container-high text-on-surface"}`}>
                    {r.typeLabel}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs tabular-nums text-on-surface-variant">
                  {formatPeriod(r)}
                </td>
                <td className="px-4 py-2 text-xs tabular-nums text-on-surface-variant">
                  {r.hours ? `${r.hours}h` : "\u2014"}
                </td>
                <td className="px-4 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_COLORS[r.status] ?? ""}`}>
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-[11px] text-outline-variant">
                  {r.source === "EXTERNAL_API" ? "API/Bot/Email" : "Manager"}
                </td>
                <td className="px-4 py-2 max-w-xs truncate text-[11px] text-on-surface-variant" title={r.notes ?? ""}>
                  {r.notes ?? "\u2014"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
