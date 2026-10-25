"use client";

import { MapPin } from "lucide-react";

/** Placeholder until the map phase: the Leaflet map with catchments and redirect arrows goes here. */
export function MapTab() {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed p-12 text-center">
      <MapPin className="mb-2 size-8 text-muted-foreground" aria-hidden />
      <h2 className="text-base font-semibold">Map view is coming next</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        It will show the brand&apos;s existing stores, each new allocation by status colour, catchment circles and arrows for redirected applicants. Until then, every applicant&apos;s
        drawer lists its distances to nearby stores.
      </p>
    </div>
  );
}
