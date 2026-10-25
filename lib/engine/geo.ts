import type { Assumptions } from "./assumptions";
import { cityCentroid, cityOfPin, getPin } from "./reference";
import type { Tier } from "./types";

// Distances and catchment overlap (SPEC §5.2). Pure maths on pin-code centroids.

export type OverlapBand = "Low" | "Moderate" | "Elevated" | "Blocked";

export interface Coords {
  lat: number;
  lng: number;
  /** True when the pin isn't in the pin file and the city centre is used instead. */
  approximate: boolean;
}

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const coordCache = new Map<string, Coords | null>();

/** Coordinates for a pin: the pin file, else the centre of the city its prefix belongs to (approximate), else null. */
export function coordsOf(pin: string): Coords | null {
  const hit = coordCache.get(pin);
  if (hit !== undefined) return hit;
  let result: Coords | null = null;
  const info = getPin(pin);
  if (info) result = { lat: info.lat, lng: info.lng, approximate: false };
  else {
    const centre = cityCentroid(cityOfPin(pin)?.city);
    if (centre) result = { lat: centre.lat, lng: centre.lng, approximate: true };
  }
  coordCache.set(pin, result);
  return result;
}

const distCache = new Map<string, number | null>();

/** Straight-line km between two pins; 0 for the same pin; null if either has no coordinates. */
export function distanceKm(pinA: string, pinB: string): number | null {
  if (pinA === pinB) return 0;
  const key = pinA < pinB ? `${pinA}|${pinB}` : `${pinB}|${pinA}`;
  const hit = distCache.get(key);
  if (hit !== undefined) return hit;
  const a = coordsOf(pinA);
  const b = coordsOf(pinB);
  const d = a && b ? haversineKm(a, b) : null;
  distCache.set(key, d);
  return d;
}

/**
 * Overlap of two equal circles of radius r whose centres are d apart, as a % of one circle's area.
 * A = 2r²·acos(d/2r) − (d/2)·√(4r² − d²)   for d < 2r, else 0.
 */
export function overlapPctAt(d: number, r: number): number {
  if (!(r > 0)) return 0;
  if (d <= 0) return 100;
  if (d >= 2 * r) return 0;
  const lens = 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);
  const pct = (lens / (Math.PI * r * r)) * 100;
  return Math.max(0, Math.min(100, pct));
}

/** Overlap % between the catchments of two pins. Same pin = 100. Unknown geography = 0 (callers skip such pins). */
export function overlapBetweenPins(pinA: string, pinB: string, radiusKm: number): number {
  if (pinA === pinB) return 100;
  const d = distanceKm(pinA, pinB);
  return d === null ? 0 : overlapPctAt(d, radiusKm);
}

export function catchmentRadiusKm(tier: Tier | null, a: Assumptions): number {
  return a.catchmentKm[tier ?? 2];
}

export function overlapBand(pct: number, a: Assumptions): OverlapBand {
  if (pct >= a.overlapBlockAtPct) return "Blocked";
  if (pct >= a.overlapModerateBelowPct) return "Elevated";
  if (pct >= a.overlapLowBelowPct) return "Moderate";
  return "Low";
}

/** Points for cannibalisation safety (SPEC §5.4 Location fit, second half). Blocked = 0. */
export function safetyPoints(pct: number, a: Assumptions): number {
  if (pct >= a.overlapBlockAtPct) return 0;
  if (pct >= a.overlapModerateBelowPct) return 3;
  if (pct >= a.overlapLowBelowPct) return 7;
  return 10;
}

export function roundKm(km: number): number {
  return Math.round(km * 10) / 10;
}
