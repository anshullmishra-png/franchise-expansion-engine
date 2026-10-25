"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScoreBar, STATUS_META, StatusChip } from "@/components/status";
import { getPin } from "@/lib/engine/reference";
import { STATUSES, type Decision, type Status } from "@/lib/engine/types";
import { useStore } from "@/lib/state/store";

type SortKey = "id" | "name" | "city" | "territory" | "status" | "score" | "payback";

const STATUS_ORDER: Record<Status, number> = { APPROVED: 0, CONDITIONAL: 1, REDIRECT: 2, WAITLIST: 3, HOLD: 4, REJECTED: 5 };

const paybackOf = (d: Decision) => (d.payback && Number.isFinite(d.payback.months) ? Math.round(d.payback.months) : null);
const territoryOf = (d: Decision) => d.allocation?.territoryId ?? d.ownTerritoryId ?? "";
const idCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function SortHead({ label, k, sort, onSort, className }: { label: string; k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 font-medium hover:text-foreground">
        {label} <Icon className={`size-3 ${active ? "" : "opacity-40"}`} aria-hidden />
      </button>
    </TableHead>
  );
}

export function ApplicationsTab() {
  const s = useStore();
  const r = s.result;
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "id", dir: 1 });

  const rows = useMemo(() => {
    if (!r) return [];
    const needle = q.trim().toLowerCase();
    const filtered = r.decisions.filter((d) => {
      if (s.statusFilter.length && !s.statusFilter.includes(d.status)) return false;
      if (!needle) return true;
      const area = d.pin ? (getPin(d.pin)?.area ?? "") : "";
      return [d.id, d.name ?? "", d.city ?? "", d.pin ?? "", area, territoryOf(d), d.headline, STATUS_META[d.status].label].some((x) => x.toLowerCase().includes(needle));
    });
    const val = (d: Decision): string | number => {
      switch (sort.key) {
        case "name": return (d.name ?? "").toLowerCase();
        case "city": return `${d.city ?? ""} ${d.pin ?? ""}`.toLowerCase();
        case "territory": return territoryOf(d);
        case "status": return STATUS_ORDER[d.status];
        case "score": return d.score ?? -1;
        case "payback": return paybackOf(d) ?? 9999;
        default: return d.id;
      }
    };
    return [...filtered].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : idCompare(String(x), String(y));
      return (c || idCompare(a.id, b.id)) * sort.dir;
    });
  }, [r, q, s.statusFilter, sort]);

  if (!r) return null;

  function toggleStatus(st: Status) {
    s.setStatusFilter(s.statusFilter.includes(st) ? s.statusFilter.filter((x) => x !== st) : [...s.statusFilter, st]);
  }
  const onSort = (key: SortKey) => setSort((p) => (p.key === key ? { key, dir: (p.dir * -1) as 1 | -1 } : { key, dir: key === "score" ? -1 : 1 }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ID, name, city, pin, area…" aria-label="Search applications" className="pl-8" />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {STATUSES.map((st) => {
            const on = s.statusFilter.includes(st);
            const m = STATUS_META[st];
            return (
              <button
                key={st}
                type="button"
                aria-pressed={on}
                onClick={() => toggleStatus(st)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${on ? `${m.chip} border-transparent` : "text-muted-foreground hover:bg-muted"}`}
              >
                <span className={`size-2 rounded-full ${m.dot}`} aria-hidden />
                {m.label} <span className="tabular-nums opacity-70">{r.counts[st]}</span>
              </button>
            );
          })}
          {s.statusFilter.length || q ? (
            <button type="button" onClick={() => { s.setStatusFilter([]); setQ(""); }} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
              <X className="size-3" aria-hidden /> Clear
            </button>
          ) : null}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">{rows.length} of {r.decisions.length}</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-ink-200 bg-card shadow-card">
        <Table className="min-w-[60rem]">
          <TableHeader>
            <TableRow>
              <SortHead label="ID" k="id" sort={sort} onSort={onSort} />
              <SortHead label="Name" k="name" sort={sort} onSort={onSort} />
              <SortHead label="City · pin (area)" k="city" sort={sort} onSort={onSort} />
              <SortHead label="Territory" k="territory" sort={sort} onSort={onSort} />
              <SortHead label="Status" k="status" sort={sort} onSort={onSort} />
              <SortHead label="Score" k="score" sort={sort} onSort={onSort} />
              <SortHead label="Payback" k="payback" sort={sort} onSort={onSort} />
              <TableHead>Headline</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  No applications match. Try clearing the search or filters.
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((d) => {
              const area = d.pin ? getPin(d.pin)?.area : null;
              const pb = paybackOf(d);
              const placed = !!d.allocation;
              return (
                <TableRow key={d.id} onClick={() => s.openApplicant(d.id)} className="cursor-pointer" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") s.openApplicant(d.id); }}>
                  <TableCell className="font-medium whitespace-nowrap">{d.id}</TableCell>
                  <TableCell className="whitespace-nowrap">{d.name ?? <span className="text-muted-foreground">(no name)</span>}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {d.city ?? "?"} · {d.pin ?? "no pin"}
                    {area ? <span className="text-muted-foreground"> ({area})</span> : null}
                  </TableCell>
                  <TableCell className={`whitespace-nowrap ${placed ? "" : "text-muted-foreground"}`}>{territoryOf(d) || "-"}</TableCell>
                  <TableCell><StatusChip status={d.status} /></TableCell>
                  <TableCell><ScoreBar score={d.score} status={d.status} /></TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{pb !== null ? `${pb} mo` : "-"}</TableCell>
                  <TableCell className="max-w-[26rem] truncate text-muted-foreground" title={d.headline}>{d.headline}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
