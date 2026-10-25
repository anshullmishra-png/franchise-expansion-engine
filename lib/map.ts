import type { Assumptions } from "./engine/assumptions";
import { catchmentRadiusKm, coordsOf } from "./engine/geo";
import { pinLabel, tierOfCity } from "./engine/reference";
import type { Decision, EngineResult, Status } from "./engine/types";

// What the map shows, worked out from an engine result. Pure, so it can be tested without a browser.
// Existing stores are dark squares, new allocations are circles in their status colour, waitlist/hold/rejected
// applicants are small grey dots, catchments are circles, and redirects get a dashed arrow from the pin they
// applied for to the pin they were given.

/** Hex versions of the status colours in app/status.css (Leaflet draws SVG, which can't read CSS variables). */
export const STATUS_HEX: Record<Status, string> = {
  APPROVED: "#16a34a",
  CONDITIONAL: "#0891b2",
  REDIRECT: "#2563eb",
  WAITLIST: "#d97706",
  HOLD: "#9333ea",
  REJECTED: "#dc2626",
};
export const GREY_HEX = "#94a3b8";
export const STORE_HEX = "#0f172a";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface StoreMarker extends LatLng {
  id: string;
  city: string | null;
  pin: string;
  label: string;
  radiusKm: number;
  approximate: boolean;
}

export interface AllocationMarker extends LatLng {
  id: string;
  name: string | null;
  status: Status;
  city: string | null;
  pin: string;
  label: string;
  radiusKm: number;
  approximate: boolean;
}

export interface WaitingMarker extends LatLng {
  id: string;
  name: string | null;
  status: Status;
  city: string | null;
  pin: string;
  label: string;
}

export interface Arrow {
  id: string;
  city: string | null;
  from: LatLng & { pin: string };
  to: LatLng & { pin: string };
  /** Compass bearing in degrees, 0 = north, for the arrowhead. */
  bearing: number;
  status: Status;
}

export interface MapModel {
  cities: string[];
  stores: StoreMarker[];
  allocations: AllocationMarker[];
  waiting: WaitingMarker[];
  arrows: Arrow[];
  /** Redirected applicants' original pins, drawn as hollow rings. */
  origins: (WaitingMarker & { toPin: string })[];
}

export interface MapFilter {
  /** null = every city */
  city: string | null;
  showWaiting: boolean;
}

export function bearingDeg(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLng = rad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/**
 * Markers that share a pin would sit exactly on top of each other. Fan them out in a small ring (about 70 m)
 * so each one can be seen and clicked. The same input always gives the same positions.
 */
export function spread<T extends LatLng & { pin: string; id: string }>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const it of items) groups.set(it.pin, [...(groups.get(it.pin) ?? []), it]);
  const out: T[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    sorted.forEach((it, i) => {
      if (sorted.length === 1) return void out.push(it);
      const angle = (2 * Math.PI * i) / sorted.length;
      const dLat = (0.00065 * Math.cos(angle));
      const dLng = (0.00065 * Math.sin(angle)) / Math.max(0.2, Math.cos((it.lat * Math.PI) / 180));
      out.push({ ...it, lat: it.lat + dLat, lng: it.lng + dLng });
    });
  }
  return out;
}

const where = (pin: string) => pinLabel(pin);

function pointOf(pin: string): (LatLng & { approximate: boolean }) | null {
  const c = coordsOf(pin);
  return c ? { lat: c.lat, lng: c.lng, approximate: c.approximate } : null;
}

export function buildMapModel(result: EngineResult, assumptions: Assumptions, filter: MapFilter = { city: null, showWaiting: true }): MapModel {
  const inCity = (city: string | null) => !filter.city || city === filter.city;

  const stores: StoreMarker[] = [];
  for (const s of result.input.existingStores) {
    const p = pointOf(s.pin);
    const city = s.city;
    if (!p || !inCity(city)) continue;
    stores.push({
      id: s.id,
      city,
      pin: s.pin,
      lat: p.lat,
      lng: p.lng,
      label: `${s.id}, ${where(s.pin)}${s.openedYear ? `, opened ${s.openedYear}` : ""}`,
      radiusKm: catchmentRadiusKm(tierOfCity(city), assumptions),
      approximate: p.approximate,
    });
  }

  const allocations: AllocationMarker[] = [];
  const waiting: WaitingMarker[] = [];
  const arrows: Arrow[] = [];
  const origins: MapModel["origins"] = [];

  for (const d of result.decisions) {
    if (d.allocation) {
      if (!inCity(d.city)) continue;
      const p = pointOf(d.allocation.pin);
      if (!p) continue;
      allocations.push({
        id: d.id,
        name: d.name,
        status: d.status,
        city: d.city,
        pin: d.allocation.pin,
        lat: p.lat,
        lng: p.lng,
        label: `${d.id} ${d.name ?? ""}: ${d.status.toLowerCase()} at ${where(d.allocation.pin)}, ${d.allocation.territoryId}`,
        radiusKm: catchmentRadiusKm(d.tier, assumptions),
        approximate: p.approximate,
      });
      const from = d.allocation.redirectedFrom;
      if (from && from.pin !== d.allocation.pin) {
        const origin = pointOf(from.pin);
        if (origin) {
          const a = { ...origin, pin: from.pin };
          const b = { lat: p.lat, lng: p.lng, pin: d.allocation.pin };
          arrows.push({ id: d.id, city: d.city, from: a, to: b, bearing: bearingDeg(a, b), status: d.status });
          origins.push({ id: d.id, name: d.name, status: d.status, city: d.city, pin: from.pin, lat: origin.lat, lng: origin.lng, toPin: d.allocation.pin, label: `${d.id} applied for ${where(from.pin)}` });
        }
      }
    } else if (filter.showWaiting && d.pin && isGreyStatus(d)) {
      if (!inCity(d.city)) continue;
      const p = pointOf(d.pin);
      if (!p) continue;
      waiting.push({ id: d.id, name: d.name, status: d.status, city: d.city, pin: d.pin, lat: p.lat, lng: p.lng, label: `${d.id} ${d.name ?? ""}: ${d.status.toLowerCase()}, applied for ${where(d.pin)}` });
    }
  }

  const cities = [...new Set([...result.input.existingStores.map((s) => s.city), ...result.decisions.map((d) => d.city)].filter((c): c is string => !!c))].sort();
  return {
    cities,
    stores,
    allocations: spread(allocations),
    waiting: spread(waiting),
    arrows,
    origins: spread(origins),
  };
}

function isGreyStatus(d: Decision): boolean {
  return d.status === "WAITLIST" || d.status === "HOLD" || d.status === "REJECTED";
}

/** Every position on the map, for fitting the view. */
export function allPoints(m: MapModel): LatLng[] {
  return [...m.stores, ...m.allocations, ...m.waiting, ...m.origins].map((x) => ({ lat: x.lat, lng: x.lng }));
}

/** The small map in an applicant's drawer: their pin(s), and the existing stores close enough to matter. */
export function buildFocusModel(result: EngineResult, assumptions: Assumptions, id: string): MapModel | null {
  const d = result.decisionById[id];
  if (!d || !d.pin) return null;
  const full = buildMapModel(result, assumptions, { city: d.city, showWaiting: false });
  const mine = [...full.allocations.filter((a) => a.id === id)];
  const center = pointOf(d.allocation?.pin ?? d.pin);
  if (!center) return null;
  const reach = Math.max(6, catchmentRadiusKm(d.tier, assumptions) * 3);
  const own = pointOf(d.pin);
  const centers = [center, ...(own && d.allocation ? [own] : [])];
  const near = (p: LatLng) =>
    centers.some((c) => Math.hypot((p.lat - c.lat) * 111, (p.lng - c.lng) * 111 * Math.cos((c.lat * Math.PI) / 180)) <= reach);
  return {
    cities: full.cities,
    stores: full.stores.filter(near),
    allocations: mine.length ? mine : [],
    waiting: !d.allocation && own ? [{ id: d.id, name: d.name, status: d.status, city: d.city, pin: d.pin, lat: own.lat, lng: own.lng, label: `${d.id}: applied for ${where(d.pin)}` }] : [],
    arrows: full.arrows.filter((a) => a.id === id),
    origins: full.origins.filter((o) => o.id === id),
  };
}

