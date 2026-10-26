"use client";

import { CheckCircle2, ShieldAlert } from "lucide-react";
import { RULE_TEXT } from "@/lib/engine/invariants";
import { useStore } from "@/lib/state/store";

/** "✓ All 6 placement rules verified", with the six rules on hover or focus. */
export function RulesBadge() {
  const { result, engineError } = useStore();
  const ok = !!result && result.invariants.ok;
  const failed = !!result && !result.invariants.ok;
  const rules = Object.entries(RULE_TEXT);

  return (
    <span className="group relative inline-block">
      <span
        tabIndex={0}
        role="status"
        className={`inline-flex cursor-help items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          failed || engineError ? "bg-rejected-soft text-rejected-ink" : ok ? "bg-approved-soft text-approved-ink" : "bg-muted text-muted-foreground"
        }`}
      >
        {failed || engineError ? <ShieldAlert className="size-3.5" aria-hidden /> : <CheckCircle2 className="size-3.5" aria-hidden />}
        <span className="max-md:sr-only">{failed ? "Placement rules NOT satisfied" : engineError ? "Engine error" : ok ? "6 placement rules verified" : "Rules checked on every run"}</span>
      </span>
      <span className="pointer-events-none invisible absolute top-full right-0 z-50 mt-2 w-80 max-w-[85vw] rounded-lg border bg-popover p-3 text-xs text-popover-foreground opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        <span className="mb-1.5 block font-semibold">The six placement rules, re-checked after every run</span>
        <ul className="space-y-1">
          {rules.map(([k, v]) => (
            <li key={k} className="flex gap-1.5">
              <span className="font-mono font-semibold text-brand">{k}</span>
              <span>{v}</span>
            </li>
          ))}
        </ul>
        {failed && result ? (
          <span className="mt-2 block rounded bg-rejected-soft p-1.5 text-rejected-ink">{result.invariants.violations.map((v) => `${v.rule}: ${v.message}`).join(" ")}</span>
        ) : null}
      </span>
    </span>
  );
}
