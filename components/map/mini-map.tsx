"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { MapBoundary } from "@/components/map/map-boundary";
import { buildFocusModel } from "@/lib/map";
import { useStore } from "@/lib/state/store";

const MapView = dynamic(() => import("./map-view"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-xs text-ink-500">Loading the map…</div>,
});

/** The small map in an applicant's drawer: where they applied, where they landed, and the stores around. */
export function MiniMap({ id }: { id: string }) {
  const s = useStore();
  const model = useMemo(() => (s.result ? buildFocusModel(s.result, s.assumptions, id) : null), [s.result, s.assumptions, id]);
  if (!model) return null;
  return (
    <div className="map-grid mt-3 h-64 overflow-hidden rounded-xl border border-ink-200" role="img" aria-label="Map showing this applicant's pin, the allocated pin and nearby existing stores">
      <MapBoundary>
        <MapView model={model} showCatchments showArrows fitKey={id} scrollWheelZoom={false} />
      </MapBoundary>
    </div>
  );
}
