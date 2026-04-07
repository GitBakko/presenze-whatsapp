"use client";

import { createContext, useCallback, useContext, useState, ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";

export interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Se true il bottone di conferma e' rosso (azione distruttiva). */
  danger?: boolean;
}

type Resolver = (result: boolean) => void;

interface ConfirmContextValue {
  /**
   * Apre un dialog di conferma e restituisce una Promise<boolean>.
   * Esempio:
   *   if (!(await confirm({ message: "Eliminare?" }))) return;
   */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [resolver, setResolver] = useState<Resolver | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setOpts(options);
      setResolver(() => resolve);
    });
  }, []);

  const close = useCallback(
    (result: boolean) => {
      if (resolver) resolver(result);
      setResolver(null);
      setOpts(null);
    },
    [resolver]
  );

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {opts && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
          onClick={() => close(false)}
        >
          <div
            className="mx-4 w-full max-w-md rounded-lg bg-surface-container-lowest p-6 shadow-elevated"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
                    opts.danger ? "bg-rose-100 text-rose-600" : "bg-primary-fixed/30 text-primary"
                  }`}
                >
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-display text-base font-bold text-on-surface">
                    {opts.title ?? "Conferma"}
                  </h2>
                  <div className="mt-1 text-sm text-on-surface-variant">{opts.message}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => close(false)}
                className="rounded p-1 text-on-surface-variant hover:bg-surface-container"
                aria-label="Chiudi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => close(false)}
                className="rounded-md bg-surface-container px-4 py-2 text-sm font-medium text-on-surface hover:bg-surface-container-high"
                autoFocus
              >
                {opts.cancelLabel ?? "Annulla"}
              </button>
              <button
                type="button"
                onClick={() => close(true)}
                className={`rounded-md px-4 py-2 text-sm font-medium text-white shadow-card transition-shadow hover:shadow-elevated ${
                  opts.danger
                    ? "bg-rose-600 hover:bg-rose-700"
                    : "bg-gradient-to-br from-primary to-primary-container text-on-primary"
                }`}
              >
                {opts.confirmLabel ?? "Conferma"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue["confirm"] {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm deve essere usato dentro <ConfirmProvider>");
  }
  return ctx.confirm;
}
