"use client";

import Link from "next/link";
import { Ban, Calendar, KeyRound } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold tracking-tight text-primary">Impostazioni</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/settings/excluded-names"
          className="rounded-lg bg-surface-container-lowest shadow-card p-6 transition-shadow hover:shadow-elevated"
        >
          <h2 className="text-lg font-semibold text-on-surface flex items-center gap-2"><Ban className="h-4 w-4 text-rose-500" /> Nomi Esclusi</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Gestisci i nomi da escludere dal parsing dei messaggi WhatsApp
            (es. nomi di admin, bot, partner esterni).
          </p>
        </Link>

        <Link
          href="/settings/schedule"
          className="rounded-lg bg-surface-container-lowest shadow-card p-6 transition-shadow hover:shadow-elevated"
        >
          <h2 className="text-lg font-semibold text-on-surface flex items-center gap-2"><Calendar className="h-4 w-4 text-blue-500" /> Orari Dipendenti</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Configura gli orari lavorativi personalizzati per ogni dipendente
            (per calcolo ritardi e straordinari).
          </p>
        </Link>

        <Link
          href="/settings/api-keys"
          className="rounded-lg bg-surface-container-lowest shadow-card p-6 transition-shadow hover:shadow-elevated"
        >
          <h2 className="text-lg font-semibold text-on-surface flex items-center gap-2"><KeyRound className="h-4 w-4 text-amber-500" /> Chiavi API</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Gestisci le chiavi API per l&apos;integrazione con applicazioni esterne
            (es. richieste ferie/permessi dai dipendenti).
          </p>
        </Link>
      </div>
    </div>
  );
}
