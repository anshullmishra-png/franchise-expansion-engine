"use client";

import { ArrowRightLeft, CheckCircle2, Clock, PauseCircle, ShieldCheck, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Decision, Status } from "@/lib/engine/types";

// Status colours: approved green, conditional teal, redirect blue, waitlist amber, hold purple, rejected red.
// Every chip also shows the status word, so colour is never the only signal.

export const STATUS_META: Record<Status, { label: string; icon: LucideIcon; chip: string; bar: string; dot: string; tile: string }> = {
  APPROVED: { label: "Approved", icon: CheckCircle2, chip: "bg-approved-soft text-approved-ink", bar: "bg-approved", dot: "bg-approved", tile: "border-l-approved" },
  CONDITIONAL: { label: "Conditional", icon: ShieldCheck, chip: "bg-conditional-soft text-conditional-ink", bar: "bg-conditional", dot: "bg-conditional", tile: "border-l-conditional" },
  REDIRECT: { label: "Redirect", icon: ArrowRightLeft, chip: "bg-redirect-soft text-redirect-ink", bar: "bg-redirect", dot: "bg-redirect", tile: "border-l-redirect" },
  WAITLIST: { label: "Waitlist", icon: Clock, chip: "bg-waitlist-soft text-waitlist-ink", bar: "bg-waitlist", dot: "bg-waitlist", tile: "border-l-waitlist" },
  HOLD: { label: "Hold", icon: PauseCircle, chip: "bg-hold-soft text-hold-ink", bar: "bg-hold", dot: "bg-hold", tile: "border-l-hold" },
  REJECTED: { label: "Rejected", icon: XCircle, chip: "bg-rejected-soft text-rejected-ink", bar: "bg-rejected", dot: "bg-rejected", tile: "border-l-rejected" },
};

export function StatusChip({ status, className }: { status: Status; className?: string }) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", m.chip, className)}>
      <Icon className="size-3.5" aria-hidden />
      {m.label}
    </span>
  );
}

export function ScoreBar({ score, status, className }: { score: number | null; status: Status; className?: string }) {
  if (score === null) return <span className="text-muted-foreground">-</span>;
  return (
    <span className={cn("inline-flex items-center gap-2", className)} title={`${score} out of 100`}>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", STATUS_META[status].bar)} style={{ width: `${Math.max(2, Math.min(100, score))}%` }} />
      </span>
      <span className="w-6 text-right text-xs tabular-nums">{score}</span>
    </span>
  );
}

export function ConfidenceChip({ confidence }: { confidence: Decision["confidence"] }) {
  const tone = confidence === "high" ? "text-approved-ink" : confidence === "medium" ? "text-waitlist-ink" : "text-rejected-ink";
  return (
    <span className="text-xs text-muted-foreground" title="How sure the engine is: low when data is contradictory, coordinates are approximate, or AI-read text decided the outcome">
      Confidence: <span className={cn("font-medium", tone)}>{confidence}</span>
    </span>
  );
}
