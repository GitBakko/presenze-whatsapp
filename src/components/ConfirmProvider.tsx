"use client";

import { createContext, useCallback, useContext, useRef, useState, ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useModalA11y } from "@/hooks/useModalA11y";

export interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Se true il bottone di conferma e' rosso (azione distruttiva). */
  danger?: boolean;
}

export interface ConfirmWithPromptOptions extends ConfirmOptions {
  /** Placeholder del campo testuale. */
  promptPlaceholder?: string;
  /** Label sopra il campo. */
  promptLabel?: string;
  /** Valore iniziale del campo. */
  promptDefault?: string;
  /** Se true il campo e' obbligatorio per poter confermare. */
  promptRequired?: boolean;
  /** Se true usa textarea invece di input monolinea. */
  promptMultiline?: boolean;
}

export interface PromptResult {
  confirmed: boolean;
  value: string;
}

type SimpleResolver = (result: boolean) => void;
type PromptResolver = (result: PromptResult) => void;

interface ConfirmContextValue {
  /**
   * Apre un dialog di conferma semplice e restituisce Promise<boolean>.
   *   if (!(await confirm({ message: "Eliminare?" }))) return;
   */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;

  /**
   * Apre un dialog di conferma con campo testo integrato. Restituisce
   * sempre un oggetto { confirmed, value } anche se l'utente annulla
   * (value = "" in quel caso).
   *   const { confirmed, value } = await confirmWithPrompt({
   *     message: "Motivo?",
   *     promptLabel: "Motivo (opzionale)"
   *   });
   */
  confirmWithPrompt: (opts: ConfirmWithPromptOptions) => Promise<PromptResult>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

type InternalOpts =
  | ({ kind: "simple" } & ConfirmOptions)
  | ({ kind: "prompt" } & ConfirmWithPromptOptions);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<InternalOpts | null>(null);
  const [resolver, setResolver] = useState<SimpleResolver | PromptResolver | null>(null);
  const [promptValue, setPromptValue] = useState("");

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setOpts({ kind: "simple", ...options });
      setResolver(() => resolve);
      setPromptValue("");
    });
  }, []);

  const confirmWithPrompt = useCallback(
    (options: ConfirmWithPromptOptions): Promise<PromptResult> => {
      return new Promise<PromptResult>((resolve) => {
        setOpts({ kind: "prompt", ...options });
        setResolver(() => resolve);
        setPromptValue(options.promptDefault ?? "");
      });
    },
    []
  );

  const close = useCallback(
    (confirmed: boolean) => {
      if (resolver && opts) {
        if (opts.kind === "prompt") {
          (resolver as PromptResolver)({ confirmed, value: confirmed ? promptValue : "" });
        } else {
          (resolver as SimpleResolver)(confirmed);
        }
      }
      setResolver(null);
      setOpts(null);
      setPromptValue("");
    },
    [resolver, opts, promptValue]
  );

  const isPrompt = opts?.kind === "prompt";
  const canConfirm =
    !isPrompt ||
    !(opts as ConfirmWithPromptOptions).promptRequired ||
    promptValue.trim().length > 0;

  return (
    <ConfirmContext.Provider value={{ confirm, confirmWithPrompt }}>
      {children}
      {opts && (
        <ConfirmDialog
          opts={opts}
          isPrompt={isPrompt}
          canConfirm={canConfirm}
          promptValue={promptValue}
          setPromptValue={setPromptValue}
          close={close}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  opts,
  isPrompt,
  canConfirm,
  promptValue,
  setPromptValue,
  close,
}: {
  opts: InternalOpts;
  isPrompt: boolean;
  canConfirm: boolean;
  promptValue: string;
  setPromptValue: (v: string) => void;
  close: (confirmed: boolean) => void;
}) {
  const modalContentRef = useRef<HTMLDivElement>(null);
  const handleClose = useCallback(() => close(false), [close]);
  useModalA11y(modalContentRef, handleClose);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={() => { if (!opts?.danger) close(false); }}
    >
      <div
        ref={modalContentRef}
        className="mx-4 w-full max-w-md rounded-lg bg-surface-container-lowest p-6 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
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
            <div className="flex-1">
              <h2 id="confirm-dialog-title" className="font-display text-base font-bold text-on-surface">
                {opts.title ?? "Conferma"}
              </h2>
              <div className="mt-1 text-sm text-on-surface-variant">{opts.message}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => close(false)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-on-surface-variant hover:bg-surface-container focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none focus:outline-none"
            aria-label="Chiudi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isPrompt && (
          <div className="mt-4">
            {(opts as ConfirmWithPromptOptions).promptLabel && (
              <label className="mb-1 block text-xs font-medium text-on-surface-variant">
                {(opts as ConfirmWithPromptOptions).promptLabel}
                {(opts as ConfirmWithPromptOptions).promptRequired && (
                  <span className="text-error"> *</span>
                )}
              </label>
            )}
            {(opts as ConfirmWithPromptOptions).promptMultiline ? (
              <textarea
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                placeholder={(opts as ConfirmWithPromptOptions).promptPlaceholder}
                rows={3}
                className="w-full rounded border-0 bg-surface-container-highest px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none focus:outline-none"
                autoFocus
              />
            ) : (
              <input
                type="text"
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                placeholder={(opts as ConfirmWithPromptOptions).promptPlaceholder}
                className="w-full rounded border-0 bg-surface-container-highest px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none focus:outline-none"
                autoFocus
              />
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => close(false)}
            className="min-h-[44px] rounded-md bg-surface-container px-4 py-2 text-sm font-medium text-on-surface hover:bg-surface-container-high focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none focus:outline-none"
          >
            {opts.cancelLabel ?? "Annulla"}
          </button>
          <button
            type="button"
            onClick={() => close(true)}
            disabled={!canConfirm}
            className={`rounded-md px-4 py-2 text-sm font-medium shadow-card transition-shadow hover:shadow-elevated disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none focus:outline-none ${
              opts.danger
                ? "bg-rose-600 hover:bg-rose-700 text-white"
                : "bg-primary hover:bg-primary-container text-on-primary"
            }`}
          >
            {opts.confirmLabel ?? "Conferma"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm(): ConfirmContextValue["confirm"] {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm deve essere usato dentro <ConfirmProvider>");
  }
  return ctx.confirm;
}

export function useConfirmWithPrompt(): ConfirmContextValue["confirmWithPrompt"] {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirmWithPrompt deve essere usato dentro <ConfirmProvider>");
  }
  return ctx.confirmWithPrompt;
}
