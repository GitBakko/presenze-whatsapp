"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface EmployeeProfile {
  id: string;
  name: string;
  displayName: string | null;
  avatarUrl: string | null;
  aliases: string[];
  hireDate: string | null;
  contractType: string;
}

export default function EmployeeEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [contractType, setContractType] = useState("FULL_TIME");
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/employees/${id}`)
      .then((r) => r.json())
      .then((data: EmployeeProfile) => {
        setProfile(data);
        setDisplayName(data.displayName ?? "");
        setHireDate(data.hireDate ?? "");
        setContractType(data.contractType ?? "FULL_TIME");
        if (data.avatarUrl) setPreview(data.avatarUrl);
      })
      .finally(() => setLoading(false));
  }, [id]);

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
              <img
                src={preview}
                alt="Avatar"
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
