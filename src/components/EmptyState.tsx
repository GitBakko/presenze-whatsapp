"use client";

import { Inbox } from "lucide-react";

interface EmptyStateProps {
  icon?: React.ElementType;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon: Icon = Inbox, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-lowest py-16 text-center">
      <Icon className="mb-3 h-10 w-10 text-outline-variant" />
      <p className="text-sm text-on-surface-variant">{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
