"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmProvider";
import { KeyRound, Copy, Check } from "lucide-react";

interface EmployeeProfile {
  id: string;
  name: string;
  displayName: string | null;
  avatarUrl: string | null;
  aliases: string[];
  hireDate: string | null;
  contractType: string;
  email: string | null;
  nfcUid: string | null;
  telegramChatId: string | null;
  telegramUsername: string | null;
  vacationCarryOver: number;
  rolCarryOver: number;
  vacationAccrualAdjust: number;
  rolAccrualAdjust: number;
}

export default function EmployeeEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [contractType, setContractType] = useState("FULL_TIME");
  const [email, setEmail] = useState("");
  const [nfcUid, setNfcUid] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramUsername, setTelegramUsername] = useState("");
  const [vacationCarryOver, setVacationCarryOver] = useState("0");
  const [rolCarryOver, setRolCarryOver] = useState("0");
  const [vacationAccrualAdjust, setVacationAccrualAdjust] = useState("0");
  const [rolAccrualAdjust, setRolAccrualAdjust] = useState("0");
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Employee API Key state
  const confirm = useConfirm();
  const [apiKeyState, setApiKeyState] = useState<{
    exists: boolean;
    active?: boolean;
    createdAt?: string;
  } | null>(null);
  const [newKeyPlaintext, setNewKeyPlaintext] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);

  const loadApiKeyState = useCallback(async () => {
    try {
      const res = await fetch(`/api/employees/${id}/api-key`);
      if (res.ok) setApiKeyState(await res.json());
    } catch {
      // ignore
    }
  }, [id]);

  const handleGenerateKey = async () => {
    if (apiKeyState?.exists) {
      const ok = await confirm({
        title: "Rigenera API Key",
        message: "La chiave attuale verrà invalidata. Le applicazioni che la usano smetteranno di funzionare. Continuare?",
        confirmLabel: "Rigenera",
        danger: true,
      });
      if (!ok) return;
    }
    setKeyBusy(true);
    try {
      const res = await fetch(`/api/employees/${id}/api-key`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setNewKeyPlaintext(data.key);
        setKeyCopied(false);
        toast.success("API Key generata");
        loadApiKeyState();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Errore nella generazione");
      }
    } finally {
      setKeyBusy(false);
    }
  };

  const handleToggleActive = async () => {
    setKeyBusy(true);
    try {
      const res = await fetch(`/api/employees/${id}/api-key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !apiKeyState?.active }),
      });
      if (res.ok) {
        toast.success(apiKeyState?.active ? "API Key disattivata" : "API Key riattivata");
        loadApiKeyState();
      }
    } finally {
      setKeyBusy(false);
    }
  };

  const handleDeleteKey = async () => {
    const ok = await confirm({
      title: "Elimina API Key",
      message: "La chiave verrà eliminata definitivamente. Per usare il portale dipendente dovrà essere rigenerata.",
      confirmLabel: "Elimina",
      danger: true,
    });
    if (!ok) return;
    setKeyBusy(true);
    try {
      await fetch(`/api/employees/${id}/api-key`, { method: "DELETE" });
      toast.success("API Key eliminata");
      setNewKeyPlaintext(null);
      loadApiKeyState();
    } finally {
      setKeyBusy(false);
    }
  };

  const copyKey = () => {
    if (!newKeyPlaintext) return;
    navigator.clipboard.writeText(newKeyPlaintext);
    setKeyCopied(true);
    toast.success("Chiave copiata negli appunti");
    setTimeout(() => setKeyCopied(false), 3000);
  };

  useEffect(() => {
    fetch(`/api/employees/${id}`)
      .then((r) => r.json())
      .then((data: EmployeeProfile) => {
        setProfile(data);
        setDisplayName(data.displayName ?? "");
        setHireDate(data.hireDate ?? "");
        setContractType(data.contractType ?? "FULL_TIME");
        setEmail(data.email ?? "");
        setNfcUid(data.nfcUid ?? "");
        setTelegramChatId(data.telegramChatId ?? "");
        setTelegramUsername(data.telegramUsername ?? "");
        setVacationCarryOver(String(data.vacationCarryOver ?? 0));
        setRolCarryOver(String(data.rolCarryOver ?? 0));
        setVacationAccrualAdjust(String(data.vacationAccrualAdjust ?? 0));
        setRolAccrualAdjust(String(data.rolAccrualAdjust ?? 0));
        if (data.avatarUrl) setPreview(data.avatarUrl);
      })
      .finally(() => setLoading(false));
    loadApiKeyState();
  }, [id, loadApiKeyState]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    const form = new FormData();
    form.append("displayName", displayName);
    if (hireDate) form.append("hireDate", hireDate);
    form.append("contractType", contractType);
    form.append("email", email);
    form.append("nfcUid", nfcUid);
    form.append("telegramChatId", telegramChatId);
    form.append("telegramUsername", telegramUsername);
    form.append("vacationCarryOver", vacationCarryOver);
    form.append("rolCarryOver", rolCarryOver);
    form.append("vacationAccrualAdjust", vacationAccrualAdjust);
    form.append("rolAccrualAdjust", rolAccrualAdjust);
    if (selectedFile) form.append("avatar", selectedFile);

    const res = await fetch(`/api/employees/${id}`, { method: "PUT", body: form });
    if (res.ok) {
      const updated: EmployeeProfile = await res.json();
      setProfile(updated);
      setSelectedFile(null);
      if (updated.avatarUrl) setPreview(updated.avatarUrl);
      setMessage({ type: "ok", text: "Profilo aggiornato!" });
    } else {
      const err = await res.json();
      setMessage({ type: "err", text: err.error || "Errore nel salvataggio" });
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-outline-variant">
        Caricamento...
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="rounded-lg bg-surface-container-lowest shadow-card p-8 text-center text-outline-variant">
        Dipendente non trovato
      </div>
    );
  }

  const initials = (profile.displayName || profile.name)
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/employees"
          className="text-sm text-primary hover:text-primary-container"
        >
          ← Dipendenti
        </Link>
        <h1 className="font-display text-3xl font-bold tracking-tight text-primary">Modifica Profilo</h1>
      </div>

      <div className="mx-auto max-w-lg rounded-lg bg-surface-container-lowest shadow-card p-6">
        {/* Avatar section */}
        <div className="mb-6 flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="group relative h-24 w-24 overflow-hidden rounded-full border-2 border-surface-container transition-all hover:border-primary hover:shadow-elevated"
          >
            {preview ? (
              <Image
                src={preview}
                alt="Avatar"
                fill
                unoptimized
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary to-primary-container text-2xl font-bold text-on-primary">
                {initials}
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              <span className="text-sm font-medium text-white">Cambia</span>
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleFileChange}
            className="hidden"
          />
          <p className="text-xs text-outline-variant">
            Clicca per caricare un avatar (max 2MB)
          </p>
        </div>

        {/* Name fields */}
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-on-surface-variant">
              Nome originale (WhatsApp)
            </label>
            <input
              type="text"
              value={profile.name}
              disabled
              className="w-full rounded-lg border-0 bg-surface-container-highest px-3 py-2 text-sm text-on-surface-variant"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-on-surface-variant">
              Nome visualizzato
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={profile.name}
              className="w-full rounded-lg border-0 border-b-2 border-transparent bg-surface-container-highest px-3 py-2 text-sm text-on-surface focus:border-primary focus:ring-0"
            />
            <p className="mt-1 text-xs text-outline-variant">
              Lascia vuoto per usare il nome originale
            </p>
          </div>

          {/* Contract fields */}
          <div>
            <label className="mb-1 block text-sm font-medium text-on-surface-variant">
              Data assunzione
            </label>
            <input
              type="date"
              value={hireDate}
              onChange={(e) => setHireDate(e.target.value)}
              className="w-full rounded-lg border-0 border-b-2 border-transparent bg-surface-container-highest px-3 py-2 text-sm text-on-surface focus:border-primary focus:ring-0"
            />
            <p className="mt-1 text-xs text-outline-variant">
              Per il calcolo della maturazione ferie/ROL
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-on-surface-variant">
              Tipo contratto
            </label>
            <select
              value={contractType}
              onChange={(e) => setContractType(e.target.value)}
              className="w-full rounded-lg border-0 border-b-2 border-transparent bg-surface-container-highest px-3 py-2 text-sm text-on-surface focus:border-primary focus:ring-0"
            >
              <option value="FULL_TIME">Full-time (40h)</option>
              <option value="PART_TIME">Part-time</option>
            </select>
          </div>

          {/* ── Canali di contatto ─────────────────────────────────── */}
          <div className="border-t border-surface-container pt-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
              Canali di contatto
            </h3>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-on-surface-variant">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="mario.rossi@example.com"
                  className="w-full rounded-lg border-0 border-b-2 border-transparent bg-surface-container-highest px-3 py-2 text-sm text-on-surface focus:border-primary focus:ring-0"
                />
                <p className="mt-1 text-xs text-outline-variant">
                  Usata per ricevere richieste ferie via email e per le notifiche di approvazione/rifiuto
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-on-surface-variant">
                  UID tessera NFC
                </label>
                <input
                  type="text"
                  value={nfcUid}
                  onChange={(e) => setNfcUid(e.target.value)}
                  placeholder="es. 04A1B2C3"
                  className="w-full rounded-lg border-0 border-b-2 border-transparent bg-surface-container-highest px-3 py-2 font-mono text-sm text-on-surface focus:border-primary focus:ring-0"
                />
                <p className="mt-1 text-xs text-outline-variant">
                  Usa caratteri esadecimali. Puoi anche associare un UID dal pannello{" "}
                  <Link href="/settings/nfc" className="text-primary hover:underline">
                    Postazione NFC
                  </Link>
                  .
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-on-surface-variant">
                    Telegram chat ID
                  </label>
                  <input
                    type="text"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    placeholder="es. 123456789"
                    className="w-full rounded-lg border-0 border-b-2 border-transparent bg-surface-container-highest px-3 py-2 font-mono text-sm text-on-surface focus:border-primary focus:ring-0"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-on-surface-variant">
                    Username Telegram
                  </label>
                  <input
                    type="text"
                    value={telegramUsername}
                    onChange={(e) => setTelegramUsername(e.target.value)}
                    placeholder="@username"
                    className="w-full rounded-lg border-0 border-b-2 border-transparent bg-surface-container-highest px-3 py-2 text-sm text-on-surface focus:border-primary focus:ring-0"
                  />
                </div>
              </div>
              <p className="text-xs text-outline-variant">
                Il dipendente ottiene il chat ID scrivendo <code className="font-mono">/start</code> al bot. Puoi anche collegarlo dal pannello{" "}
                <Link href="/settings/telegram" className="text-primary hover:underline">
                  Bot Telegram
                </Link>
                .
              </p>
            </div>
          </div>

          {/* ── Saldi ferie e permessi ─────────────────────────────── */}
          <div className="border-t border-surface-container pt-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
              Saldi ferie e permessi (anno corrente)
            </h3>
            <p className="mb-3 text-xs text-outline-variant">
              I valori di maturazione automatici (in base ad anzianità e contratto) e l&apos;utilizzato calcolato dalle richieste approvate restano gestiti dal sistema. Qui imposti i due riporti dall&apos;anno scorso e gli aggiustamenti manuali per allineare i totali alla busta paga.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-on-surface-variant">
                  Riporto ferie da anno precedente (giorni)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={vacationCarryOver}
                  onChange={(e) => setVacationCarryOver(e.target.value)}
                  className="w-full rounded-lg border-0 border-b-2 border-transparent bg-surface-container-highest px-3 py-2 text-sm tabular-nums text-on-surface focus:border-primary focus:ring-0"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-on-surface-variant">
                  Riporto ROL da anno precedente (ore)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={rolCarryOver}
                  onChange={(e) => setRolCarryOver(e.target.value)}
                  className="w-full rounded-lg border-0 border-b-2 border-transparent bg-surface-container-highest px-3 py-2 text-sm tabular-nums text-on-surface focus:border-primary focus:ring-0"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-on-surface-variant">
                  Rettifica ferie maturate (giorni)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={vacationAccrualAdjust}
                  onChange={(e) => setVacationAccrualAdjust(e.target.value)}
                  className="w-full rounded-lg border-0 border-b-2 border-transparent bg-surface-container-highest px-3 py-2 text-sm tabular-nums text-on-surface focus:border-primary focus:ring-0"
                />
                <p className="mt-1 text-[11px] text-outline-variant">
                  Positivo se la busta paga ne mostra di più del sistema, negativo se di meno
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-on-surface-variant">
                  Rettifica ROL maturati (ore)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={rolAccrualAdjust}
                  onChange={(e) => setRolAccrualAdjust(e.target.value)}
                  className="w-full rounded-lg border-0 border-b-2 border-transparent bg-surface-container-highest px-3 py-2 text-sm tabular-nums text-on-surface focus:border-primary focus:ring-0"
                />
              </div>
            </div>
          </div>
        </div>

          {/* ── API Key personale ──────────────────────────────────── */}
          <div className="border-t border-surface-container pt-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-on-surface-variant flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" /> API Key personale
            </h3>
            <p className="mb-3 text-xs text-outline-variant">
              Consente al dipendente (o a un&apos;applicazione esterna) di leggere le proprie timbrature via API.
              Endpoint: <code className="font-mono text-[11px]">GET /api/employee-portal/records?from=...&amp;to=...</code>
            </p>

            {apiKeyState === null ? (
              <div className="text-xs text-outline-variant">Caricamento…</div>
            ) : !apiKeyState.exists ? (
              <button
                type="button"
                onClick={handleGenerateKey}
                disabled={keyBusy}
                className="rounded-md bg-gradient-to-br from-primary to-primary-container px-4 py-2 text-sm font-medium text-on-primary shadow-card hover:shadow-elevated disabled:opacity-50"
              >
                Genera API Key
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-xs">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${
                    apiKeyState.active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                  }`}>
                    {apiKeyState.active ? "Attiva" : "Disattivata"}
                  </span>
                  <span className="text-outline-variant">
                    Creata il {apiKeyState.createdAt ? new Date(apiKeyState.createdAt).toLocaleDateString("it-IT") : "—"}
                  </span>
                </div>

                {newKeyPlaintext && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                    <p className="mb-1 text-xs font-semibold text-amber-900">
                      Copia questa chiave — non verrà più mostrata!
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs text-on-surface">
                        {newKeyPlaintext}
                      </code>
                      <button
                        type="button"
                        onClick={copyKey}
                        className="inline-flex items-center gap-1 rounded-md bg-amber-200 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-300"
                      >
                        {keyCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {keyCopied ? "Copiata" : "Copia"}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateKey}
                    disabled={keyBusy}
                    className="rounded-md bg-surface-container-high px-3 py-1.5 text-xs font-medium text-on-surface hover:bg-surface-container-highest disabled:opacity-50"
                  >
                    Rigenera
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleActive}
                    disabled={keyBusy}
                    className="rounded-md bg-surface-container-high px-3 py-1.5 text-xs font-medium text-on-surface hover:bg-surface-container-highest disabled:opacity-50"
                  >
                    {apiKeyState.active ? "Disattiva" : "Riattiva"}
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteKey}
                    disabled={keyBusy}
                    className="rounded-md bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                  >
                    Elimina
                  </button>
                </div>
              </div>
            )}
          </div>

        {/* Save */}
        <div className="mt-6 flex items-center justify-between">
          {message && (
            <span
              className={`text-sm font-medium ${message.type === "ok" ? "text-success" : "text-error"}`}
            >
              {message.text}
            </span>
          )}
          <div className="ml-auto flex gap-3">
            <button
              onClick={() => router.push(`/employees/${id}`)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-low"
            >
              Calendario
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-gradient-to-br from-primary to-primary-container px-4 py-2 text-sm font-medium text-on-primary shadow-card transition-all hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Salvataggio..." : "Salva"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
