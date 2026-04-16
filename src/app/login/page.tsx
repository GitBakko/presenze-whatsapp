"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { CircleAlert, LogIn, Lock } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Le credenziali inserite non sono valide.");
    } else {
      // Verifica se l'account è attivo leggendo la sessione
      const sessionRes = await fetch("/api/auth/session");
      const session = await sessionRes.json();
      if (session?.user && !(session.user as { active?: boolean }).active) {
        setError("Il tuo account è in attesa di attivazione da parte dell'amministratore.");
        // Logout silenzioso per non lasciare una sessione inattiva
        await fetch("/api/auth/signout", { method: "POST" }); // invalida la sessione
        return;
      }
      router.push("/");
      router.refresh();
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-surface to-surface-container-high p-6">
      {/* Background decorative blobs */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-primary-fixed opacity-10 blur-3xl" />
        <div className="absolute top-1/2 -right-48 h-[32rem] w-[32rem] rounded-full bg-secondary-container opacity-20 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="mb-10 text-center">
          <Image src="/logo-dark.svg" width={120} height={80} alt="E-Partner" priority className="mx-auto mb-6" />
          <h1 className="mb-2 font-display text-4xl font-extrabold tracking-tight text-primary">
            ePartner HR
          </h1>
          <p className="tracking-wide text-on-surface-variant">
            Accedi per gestire presenze e risorse umane
          </p>
        </div>

        {/* Login Card */}
        <div className="rounded-xl bg-surface-container-lowest/95 p-8 shadow-editorial backdrop-blur-sm md:p-10">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email */}
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="ml-1 block text-[0.7rem] font-bold uppercase tracking-[0.1em] text-on-surface-variant"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="mario.rossi@azienda.it"
                className="w-full rounded-lg border-none bg-surface-container-highest px-4 py-3 text-on-surface transition-all placeholder:text-outline-variant focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label
                htmlFor="password"
                className="ml-1 block text-[0.7rem] font-bold uppercase tracking-[0.1em] text-on-surface-variant"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full rounded-lg border-none bg-surface-container-highest px-4 py-3 text-on-surface transition-all placeholder:text-outline-variant focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-3 rounded-lg border-l-4 border-error bg-error-container/30 p-4">
                <CircleAlert className="h-5 w-5 text-error" />
                <p className="text-sm font-medium text-on-error-container">
                  {error}
                </p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 py-4 font-bold text-on-primary shadow-elevated transition-all hover:bg-primary-container active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>{loading ? "Accesso in corso..." : "Accedi"}</span>
              {!loading && (
                <LogIn className="h-5 w-5" />
              )}
            </button>
          </form>

          {/* Register link */}
          <div className="mt-8 border-t border-surface-container-high pt-8 text-center">
            <p className="text-sm text-on-surface-variant">
              Non hai un account?
              <Link
                href="/register"
                className="ml-1 font-bold text-primary underline-offset-4 hover:underline"
              >
                Registrati
              </Link>
            </p>
          </div>
        </div>

        {/* Footer security note */}
        <div className="mt-8 flex items-center justify-center gap-2 opacity-40">
          <Lock className="h-3 w-3" />
          <span className="text-[0.65rem] font-bold uppercase tracking-[0.2em]">
            HTTPS / TLS
          </span>
        </div>
      </div>
    </div>
  );
}
