import { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle, LucideIcon } from "lucide-react";

export type BannerKind = "info" | "success" | "warning" | "error";

interface InfoBannerProps {
  kind: BannerKind;
  title?: string;
  children: ReactNode;
  icon?: LucideIcon;
  className?: string;
}

const KIND_CONFIG: Record<BannerKind, { container: string; iconClass: string; defaultIcon: LucideIcon }> = {
  info: {
    container: "border-primary-container/50 bg-primary-container/20 text-on-primary-container",
    iconClass: "text-primary",
    defaultIcon: Info,
  },
  success: {
    container: "border-success/30 bg-success-container/40 text-success",
    iconClass: "text-success",
    defaultIcon: CheckCircle2,
  },
  warning: {
    container: "border-warning/40 bg-warning-container/40 text-warning",
    iconClass: "text-warning",
    defaultIcon: AlertTriangle,
  },
  error: {
    container: "border-error/30 bg-error-container text-on-error-container",
    iconClass: "text-error",
    defaultIcon: XCircle,
  },
};

export function InfoBanner({ kind, title, children, icon, className = "" }: InfoBannerProps) {
  const config = KIND_CONFIG[kind];
  const Icon = icon ?? config.defaultIcon;
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-4 ${config.container} ${className}`}
    >
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${config.iconClass}`} strokeWidth={1.5} />
      <div className="flex-1 text-sm">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? "mt-1" : ""}>{children}</div>
      </div>
    </div>
  );
}
