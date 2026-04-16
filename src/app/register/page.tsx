"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { CircleAlert, Info, ArrowRight, CheckCircle2 } from "lucide-react";
import logoDarkSrc from "@/../public/logo-dark.svg";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Errore durante la registrazione");
      return;
    }

    setSuccess(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-surface to-surface-container-high p-6">
      <main className="flex w-full max-w-md flex-col items-center">
        {/* Brand header */}
        <div className="mb-8 text-center">
          <Image src={logoDarkSrc} width={120} height={80} alt="E-Partner" priority className="mx-auto mb-6" />
          <h1 className="font-display text-4xl font-extrabold tracking-tighter text-primary">
            ePartner HR
          </h1>
          <p className="mt-2 text-sm text-on-surface-variant">
            Crea il tuo account per iniziare
          </p>
        </div>

        {/* Success state */}
        {success && (
          <div className="rounded-xl bg-surface-container-lowest/95 p-8 text-center shadow-editorial backdrop-blur-xl lg:p-10">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success-container">
              <CheckCircle2 className="h-8 w-8 text-success" />
            </div>
            <h2 className="font-display text-xl font-bold text-on-surface">Registrazione completata!</h2>
            <p className="mt-3 text-sm text-on-surface-variant">
              Il tuo account è stato creato ma è in <b>attesa di attivazione</b>.<br />
              L&apos;amministratore HR lo attiverà e lo assocerà al tuo profilo dipendente.<br />
              Riceverai una notifica via email e/o Telegram quando sarà attivo.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-on-primary"
            >
              Vai al login
            </Link>
          </div>
        )}

        {/* Registration card */}
        {!success && (
        <div className="rounded-xl bg-surface-container-lowest/95 p-8 shadow-editorial backdrop-blur-xl lg:p-10">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Error */}
            {error && (
              <div className="flex items-center gap-3 rounded-lg border-l-4 border-error bg-error-container/30 p-4">
                <CircleAlert className="h-5 w-5 text-error" />
                <p className="text-sm font-medium text-on-error-container">
                  {error}
                </p>
              </div>
            )}

            {/* Nome completo */}
            <div className="space-y-1.5">
              <label
                htmlFor="name"
                className="ml-1 block text-[10px] font-semibold uppercase tracking-[0.05em] text-outline"
              >
                Nome Completo
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Mario Rossi"
                className="w-full rounded-lg border-none bg-surface-container-highest px-4 py-3 text-on-surface transition-all placeholder:text-outline-variant focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label
                htmlFor="reg-email"
                className="ml-1 block text-[10px] font-semibold uppercase tracking-[0.05em] text-outline"
              >
                Email
              </label>
              <input
                id="reg-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="mario@enterprise.it"
                className="w-full rounded-lg border-none bg-surface-container-highest px-4 py-3 text-on-surface transition-all placeholder:text-outline-variant focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label
                htmlFor="reg-password"
                className="ml-1 block text-[10px] font-semibold uppercase tracking-[0.05em] text-outline"
              >
                Password
              </label>
              <input
                id="reg-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="••••••••"
                className="w-full rounded-lg border-none bg-surface-container-highest px-4 py-3 text-on-surface transition-all placeholder:text-outline-variant focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <p className="ml-1 flex items-center gap-1 text-[11px] font-medium text-outline-variant">
              <Info className="h-3.5 w-3.5" />
              Usa il tuo indirizzo email aziendale @epartner.it
            </p>

            {/* Submit */}
            <div className="pt-4">
              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 font-display font-bold text-on-primary transition-all duration-200 hover:bg-primary-container active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Registrazione in corso..." : "Registrati"}
                {!loading && (
                  <ArrowRight className="h-5 w-5" />
                )}
              </button>
            </div>
          </form>
        </div>
        )}

        {/* Footer link */}
        <div className="mx-auto mt-6 inline-block rounded-full bg-surface-container-lowest/70 p-2 text-center">
          <p className="text-sm text-secondary">
            Hai già un account?
            <Link
              href="/login"
              className="ml-1 font-bold text-primary transition-all hover:underline"
            >
              Accedi
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
