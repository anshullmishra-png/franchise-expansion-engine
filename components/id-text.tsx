"use client";

import { Fragment } from "react";
import { useStore } from "@/lib/state/store";

const ID_RE = /\b((?:APP|TER)-\d{1,4}(?:#\d+)?)\b/g;

/** Text where every APP-/TER- ID is a button that opens that applicant's or territory's drawer. */
export function IdText({ text, className }: { text: string; className?: string }) {
  const { result, openApplicant, openTerritory } = useStore();
  const known = (id: string) => (id.startsWith("APP") ? !!result?.decisionById[id] : !!result?.territories.some((t) => t.id === id));
  const parts: (string | { id: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(ID_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push({ id: m[1] });
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <span className={className}>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <Fragment key={i}>{p}</Fragment>
        ) : known(p.id) ? (
          <button
            key={i}
            type="button"
            onClick={() => (p.id.startsWith("APP") ? openApplicant(p.id) : openTerritory(p.id))}
            className="rounded-sm font-medium text-brand underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:ring-2 focus-visible:ring-ring in-[.dark-rail]:text-teal-400"
          >
            {p.id}
          </button>
        ) : (
          <Fragment key={i}>{p.id}</Fragment>
        )
      )}
    </span>
  );
}
