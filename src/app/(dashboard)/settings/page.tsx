"use client";

import Link from "next/link";
import { Ban, Calendar, CalendarCog, FileSpreadsheet, KeyRound, Mail, MessageCircle, Nfc, Upload, Users } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-extrabold tracking-tight text-primary">Impostazioni</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/settings/users"
          className="rounded-lg bg-surface-container-lowest shadow-card p-6 transition-shadow hover:shadow-elevated"
        >
          <h2 className="text-lg font-semibold text-on-surface flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Utenti dipendenti</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Attiva gli account dei dipendenti registrati e associali al loro profilo.
          </p>
        </Link>
        <Link
          href="/settings/excluded-names"
          className="rounded-lg bg-surface-container-lowest shadow-card p-6 transition-shadow hover:shadow-elevated"
        >
          <h2 className="text-lg font-semibold text-on-surface flex items-center gap-2"><Ban className="h-4 w-4 text-primary" /> Nomi Esclusi</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Gestisci i nomi da escludere dal parsing dei messaggi WhatsApp
            (es. nomi di admin, bot, partner esterni).
          </p>
        </Link>

        <Link
          href="/settings/schedule"
          className="rounded-lg bg-surface-container-lowest shadow-card p-6 transition-shadow hover:shadow-elevated"
        >
          <h2 className="text-lg font-semibold text-on-surface flex items-center gap-2"><Calendar className="h-4 w-4 text-primary" /> Orari Dipendenti</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Configura gli orari lavorativi personalizzati per ogni dipendente
            (per calcolo ritardi e straordinari).
          </p>
        </Link>

        <Link
          href="/settings/nfc"
          className="rounded-lg bg-surface-container-lowest shadow-card p-6 transition-shadow hover:shadow-elevated"
        >
          <h2 className="text-lg font-semibold text-on-surface flex items-center gap-2"><Nfc className="h-4 w-4 text-primary" /> Postazione NFC</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Associa le tessere CIE/NFC ai dipendenti e gestisci gli UID
            non riconosciuti dal kiosk di ingresso.
          </p>
        </Link>

        <Link
          href="/settings/telegram"
          className="rounded-lg bg-surface-container-lowest shadow-card p-6 transition-shadow hover:shadow-elevated"
        >
          <h2 className="text-lg font-semibold text-on-surface flex items-center gap-2"><MessageCircle className="h-4 w-4 text-primary" /> Bot Telegram</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Collega i chat Telegram dei dipendenti per consentire timbrature
            e richieste ferie via bot.
          </p>
        </Link>

        <Link
          href="/settings/email-ingest"
          className="rounded-lg bg-surface-container-lowest shadow-card p-6 transition-shadow hover:shadow-elevated"
        >
          <h2 className="text-lg font-semibold text-on-surface flex items-center gap-2"><Mail className="h-4 w-4 text-primary" /> Ferie via Email</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Acquisizione automatica delle richieste ferie inviate via email
            con oggetto &quot;ferie&quot; e formato DAL/AL.
          </p>
        </Link>

        <Link
          href="/import"
          className="rounded-lg bg-surface-container-lowest shadow-card p-6 transition-shadow hover:shadow-elevated"
        >
          <h2 className="text-lg font-semibold text-on-surface flex items-center gap-2"><Upload className="h-4 w-4 text-primary" /> Importa WhatsApp</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Importa storico presenze da un file di esportazione della chat WhatsApp (.txt).
          </p>
        </Link>

        <Link
          href="/settings/api-keys"
          className="rounded-lg bg-surface-container-lowest shadow-card p-6 transition-shadow hover:shadow-elevated"
        >
          <h2 className="text-lg font-semibold text-on-surface flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" /> Chiavi API</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Gestisci le chiavi API per l&apos;integrazione con applicazioni esterne
            (es. richieste ferie/permessi dai dipendenti).
          </p>
        </Link>

        <Link
          href="/settings/payroll-import"
          className="rounded-lg bg-surface-container-lowest shadow-card p-6 transition-shadow hover:shadow-elevated"
        >
          <h2 className="text-lg font-semibold text-on-surface flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-primary" /> Import tabulato paghe</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Importa ferie, festività e permessi dal PDF del consulente paghe e riallinea i saldi dipendenti.
          </p>
        </Link>

        <Link
          href="/settings/monthly-report"
          className="rounded-lg bg-surface-container-lowest shadow-card p-6 transition-shadow hover:shadow-elevated"
        >
          <h2 className="text-lg font-semibold text-on-surface flex items-center gap-2"><CalendarCog className="h-4 w-4 text-primary" /> Report automatico</h2>
          <p className="mt-2 text-sm text-on-surface-variant">
            Invio mensile del foglio presenze agli amministratori.
          </p>
        </Link>
      </div>
    </div>
  );
}
