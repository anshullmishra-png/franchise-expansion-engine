"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { LocateFixed } from "lucide-react";
import { MapBoundary } from "@/components/map/map-boundary";
import { STATUS_META } from "@/components/status";
import { STATUSES } from "@/lib/engine/types";
import { buildMapModel } from "@/lib/map";
import { useStore } from "@/lib/state/store";

const MapView = dynamic(() => import("@/components/map/map-view"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-ink-500">Loading the map…</div>,
});

const ALL = "__all__";

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 shadow-card has-[:checked]:border-teal-700/30 has-[:checked]:bg-teal-50 has-[:checked]:text-teal-800">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-teal-700" />
      {children}
    </label>
  );
}

/** Existing stores, new allocations, catchments and redirects on a real map (Leaflet + OpenStreetMap). */
export function MapTab() {
  const s = useStore();
  const [picked, setPicked] = useState<string | null>(null);
  const [catchments, setCatchments] = useState(true);
  const [arrows, setArrows] = useState(true);
  const [waiting, setWaiting] = useState(true);

  const full = useMemo(() => (s.result ? buildMapModel(s.result, s.assumptions, { city: null, showWaiting: true }) : null), [s.result, s.assumptions]);

  // Default to the city with the most stores, so the first view is a readable street-level picture.
  const busiest = useMemo(() => {
    if (!full) return ALL;
    const counts = new Map<string, number>();
    for (const m of [...full.stores, ...full.allocations]) if (m.city) counts.set(m.city, (counts.get(m.city) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? ALL;
  }, [full]);

  const city = picked ?? busiest;
  const cityFilter = city === ALL ? null : city;
  const model = useMemo(() => (s.result ? buildMapModel(s.result, s.assumptions, { city: cityFilter, showWaiting: waiting }) : null), [s.result, s.assumptions, cityFilter, waiting]);

  if (!s.result || !full || !model) return null;
  const approx = [...model.stores, ...model.allocations].some((m) => m.approximate);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 text-xs font-medium text-ink-600">
          <span className="tracky text-[11px] font-bold text-ink-500 uppercase">City</span>
          <select
            value={city}
            onChange={(e) => setPicked(e.target.value)}
            className="h-8 rounded-lg border border-ink-200 bg-white px-2 text-sm text-ink-900 shadow-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Filter the map by city"
          >
            <option value={ALL}>All cities</option>
            {full.cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <Toggle on={catchments} onChange={setCatchments}>
          Catchment circles
        </Toggle>
        <Toggle on={arrows} onChange={setArrows}>
          Redirect arrows
        </Toggle>
        <Toggle on={waiting} onChange={setWaiting}>
          Waitlist, hold and rejected
        </Toggle>
        <span className="ml-auto text-xs text-ink-500">
          {model.stores.length} existing · {model.allocations.length} new · {model.arrows.length} redirected
        </span>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card">
        <div className="map-grid h-[420px] sm:h-[520px] lg:h-[calc(100dvh-20rem)] lg:min-h-[460px]">
          <MapBoundary>
            <MapView model={model} showCatchments={catchments} showArrows={arrows} fitKey={`${city}|${waiting}`} onOpenApplicant={s.openApplicant} />
          </MapBoundary>
        </div>
        <span className="tracky pointer-events-none absolute top-3 left-3 z-[500] inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-bold text-teal-800 uppercase shadow-card ring-1 ring-ink-200">
          <LocateFixed className="size-3.5 text-teal-700" aria-hidden /> {city === ALL ? "All cities" : city}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-ink-200 bg-white px-4 py-3 text-xs text-ink-600 shadow-card" aria-label="Map legend">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-[3px] border-2 border-white bg-ink-900 shadow" aria-hidden /> Existing store
        </span>
        {STATUSES.filter((st) => st !== "WAITLIST" && st !== "HOLD" && st !== "REJECTED").map((st) => (
          <span key={st} className="inline-flex items-center gap-1.5">
            <span className={`size-3 rounded-full border-2 border-white shadow ${STATUS_META[st].dot}`} aria-hidden /> New store, {STATUS_META[st].label.toLowerCase()}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-ink-400" aria-hidden /> Waitlist, hold or rejected (where they applied)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-full border-2 border-dashed border-redirect bg-white" aria-hidden /> Pin a redirected applicant applied for, with a dashed arrow to the pin they were given
        </span>
      </div>
      <p className="text-xs text-ink-500">
        Circles are catchments (Tier 1: {s.assumptions.catchmentKm[1]} km, Tier 2: {s.assumptions.catchmentKm[2]} km, Tier 3: {s.assumptions.catchmentKm[3]} km). Positions are pin-code centres, not exact shop addresses.
        {approx ? " Some pins aren't in the pin file, so they sit at the city centre and are approximate." : ""} Click a coloured marker to open the applicant.
      </p>
    </div>
  );
}
