"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-outline-variant" />}
            {isLast || !item.href ? (
              <span aria-current={isLast ? "page" : undefined} className={isLast ? "font-semibold text-on-surface" : "text-on-surface-variant"}>
                {item.label}
              </span>
            ) : (
              <Link href={item.href} className="text-on-surface-variant hover:text-primary hover:underline">
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
