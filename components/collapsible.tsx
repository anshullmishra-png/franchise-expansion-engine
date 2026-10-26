"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

/** A card whose body folds away, so a long page can show the answer first and the detail on request. */
export function CollapsibleCard({
  icon: Icon,
  title,
  description,
  count,
  defaultOpen = false,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="rounded-2xl border border-ink-200 bg-card shadow-card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left transition-colors hover:bg-teal-50/60"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ink-100 text-ink-600 transition-colors group-hover:bg-teal-100 group-hover:text-teal-800">
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[15px] font-semibold text-ink-900">
            {title}
            {count !== undefined ? <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600 tabular-nums">{count}</span> : null}
          </span>
          {description ? <span className="mt-0.5 block text-[13px] leading-snug text-ink-500">{description}</span> : null}
        </span>
        <ChevronDown className={`size-5 shrink-0 text-ink-400 transition-transform duration-200 group-hover:text-teal-700 ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      <div id={id} className="collapse" data-open={open} role="region" aria-hidden={!open}>
        <div>
          <div className="border-t border-ink-100 px-5 py-4">{children}</div>
        </div>
      </div>
    </section>
  );
}
