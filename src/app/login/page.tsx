"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clock, CircleAlert, LogIn, Lock } from "lucide-react";

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
      router.push("/");
      router.refresh();
    }
  };

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-cover bg-center bg-fixed p-6"
      style={{
        backgroundImage:
          "url('https://lh3.googleusercontent.com/aida-public/AB6AXuCahqfV34AMLb9q8_uMjV4OkeUDoWy8ZKVpJCboY4hUPno3YJCmTdpGIaBcJ8K17fYn3PAiPtlKgmezKWOxgLHJNQLCfAVNSoo4SbkmjZ_LfSd75DlWPTYCMc2LgC-LDaTyrjGBRC4wcM0LkHZKO_qi4zbT9oVCEi4qx74neZDR5rLVhzyTx93jWmBjzCw72mfNZ2Brvn8jSfGvIlM404r-x9CRD1e9LiFcyZ2uKDzMif6w6n1QYnM21rMDJ2DyAWl4Gch-tWvEIsWA')",
      }}
    >
      {/* Background decorative blobs */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-primary-fixed opacity-10 blur-3xl" />
        <div className="absolute top-1/2 -right-48 h-[32rem] w-[32rem] rounded-full bg-secondary-container opacity-20 blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="mb-10 text-center">
          <div className="mx-auto mb-6 inline-flex h-16 w-16 items-center justify-center rounded-xl bg-white/95 shadow-editorial backdrop-blur-sm">
            <Clock className="h-8 w-8 text-primary" />
          </div>
          <h1 className="mb-2 font-display text-4xl font-extrabold tracking-tight text-primary">
            Presenze
          </h1>
          <p className="tracking-wide text-on-surface-variant">
            Accedi per gestire le presenze
          </p>
        </div>

        {/* Login Card */}
        <div className="rounded-xl bg-white/95 p-8 shadow-editorial backdrop-blur-sm md:p-10">
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
                className="w-full rounded-lg border-none bg-surface-container-highest px-4 py-3 text-on-surface transition-all placeholder:text-outline-variant focus:border-b-2 focus:border-primary focus:ring-0"
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
                className="w-full rounded-lg border-none bg-surface-container-highest px-4 py-3 text-on-surface transition-all placeholder:text-outline-variant focus:border-b-2 focus:border-primary focus:ring-0"
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
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-primary to-primary-container px-6 py-4 font-bold text-on-primary shadow-lg transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
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
            Connessione sicura SSL 256-bit
          </span>
        </div>
      </div>

      {/* Bottom gradient bar */}
      <div className="fixed bottom-0 left-0 right-0 hidden h-1 bg-gradient-to-r from-primary via-primary-container to-secondary lg:block" />
    </div>
  );
}
