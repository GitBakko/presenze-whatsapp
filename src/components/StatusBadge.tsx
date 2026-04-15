import { ReactNode } from "react";

export type StatusKind = "success" | "warning" | "error" | "info" | "neutral";

interface StatusBadgeProps {
  kind: StatusKind;
  children: ReactNode;
  className?: string;
}

const KIND_CLASSES: Record<StatusKind, string> = {
  success: "bg-success-container text-success",
  warning: "bg-warning-container text-warning",
  error: "bg-error-container text-on-error-container",
  info: "bg-primary-container/40 text-on-primary-container",
  neutral: "bg-surface-container-high text-on-surface-variant",
};

export function StatusBadge({ kind, children, className = "" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${KIND_CLASSES[kind]} ${className}`}
    >
      {children}
    </span>
  );
}
