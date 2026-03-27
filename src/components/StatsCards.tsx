import { DynamicIcon } from "lucide-react/dynamic";
import type { IconName } from "lucide-react/dynamic";

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: string;
  color?: "blue" | "green" | "yellow" | "red" | "gray";
}

const accentMap = {
  blue: "border-primary",
  green: "border-success",
  yellow: "border-warning",
  red: "border-error",
  gray: "border-outline-variant",
};

const iconBgMap = {
  blue: "bg-primary-fixed text-primary",
  green: "bg-success-container text-success",
  yellow: "bg-warning-container text-warning",
  red: "bg-error-container text-error",
  gray: "bg-surface-container-high text-secondary",
};

export function StatsCards({ cards }: { cards: StatsCardProps[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card, i) => (
        <div
          key={i}
          className={`rounded-lg border-b-2 bg-surface-container-lowest p-6 shadow-card ${accentMap[card.color || "gray"]}`}
        >
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.1em] text-secondary">
            {card.title}
          </p>
          <div className="flex items-center justify-between">
            <h3 className="font-display text-4xl font-extrabold tabular-nums text-primary">
              {card.value}
            </h3>
            {card.icon && (
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-full ${iconBgMap[card.color || "gray"]}`}
              >
                <DynamicIcon name={card.icon as IconName} className="h-5 w-5" strokeWidth={1.75} />
              </div>
            )}
          </div>
          {card.subtitle && (
            <p className="mt-4 text-xs text-on-surface-variant">{card.subtitle}</p>
          )}
        </div>
      ))}
    </div>
  );
}
