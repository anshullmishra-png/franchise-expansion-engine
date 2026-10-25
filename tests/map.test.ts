import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS, runEngine } from "../lib/engine";
import { parseWorkbook } from "../lib/engine/parse";
import { STATUS_HEX, allPoints, bearingDeg, buildFocusModel, buildMapModel, spread } from "../lib/map";

const parsed = parseWorkbook(readFileSync(path.join(process.cwd(), "test-data/Stress_Test_Case1.xlsx")));
const result = runEngine(parsed.input, undefined, undefined, { today: "2026-10-25", simulate: false });
const A = DEFAULT_ASSUMPTIONS;

describe("map model", () => {
  it("lists every city in the file, sorted", () => {
    expect(buildMapModel(result, A).cities).toEqual(["Bengaluru", "Belagavi", "Davanagere", "Hubballi-Dharwad", "Mangaluru", "Mysuru", "Tumakuru"].sort());
  });

  it("Bengaluru view shows ST-01..05 with their catchment radius", () => {
    const m = buildMapModel(result, A, { city: "Bengaluru", showWaiting: true });
    expect(m.stores.map((s) => s.id)).toEqual(["ST-01", "ST-02", "ST-03", "ST-04", "ST-05"]);
    expect(m.stores.every((s) => s.radiusKm === 2)).toBe(true);
    expect(m.stores.every((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))).toBe(true);
  });

  it("uses each tier's radius: Mysuru stores are 3 km, a Tier 3 allocation is 5 km", () => {
    const mys = buildMapModel(result, A, { city: "Mysuru", showWaiting: false });
    expect(mys.stores.map((s) => s.radiusKm)).toEqual([3, 3]);
    const tum = buildMapModel(result, A, { city: "Tumakuru", showWaiting: false });
    expect(tum.allocations.every((a) => a.radiusKm === 5)).toBe(true);
    const changed = buildMapModel(result, { ...A, catchmentKm: { ...A.catchmentKm, 2: 2 } }, { city: "Mysuru", showWaiting: false });
    expect(changed.stores.map((s) => s.radiusKm)).toEqual([2, 2]);
  });

  it("puts every allocated applicant on the map in their status colour, at the allocated pin", () => {
    const m = buildMapModel(result, A);
    const placed = result.decisions.filter((d) => d.allocation);
    expect(m.allocations).toHaveLength(placed.length);
    for (const a of m.allocations) {
      const d = result.decisionById[a.id];
      expect(a.status).toBe(d.status);
      expect(a.pin).toBe(d.allocation!.pin);
      expect(STATUS_HEX[a.status]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("never plots two stores at one pin (the placement rule, visible on the map)", () => {
    const pins = buildMapModel(result, A).allocations.map((a) => a.pin);
    expect(new Set(pins).size).toBe(pins.length);
    const storePins = new Set(result.input.existingStores.map((s) => s.pin));
    for (const p of pins) expect(storePins.has(p)).toBe(false);
  });

  it("draws a dashed arrow for each redirected applicant, from the applied pin to the given pin", () => {
    const m = buildMapModel(result, A);
    const redirects = result.decisions.filter((d) => d.status === "REDIRECT");
    expect(redirects.length).toBeGreaterThan(0);
    expect(m.arrows.map((a) => a.id).sort()).toEqual(redirects.map((d) => d.id).sort());
    const a4 = m.arrows.find((a) => a.id === "APP-004")!;
    expect(a4.from.pin).toBe("560008");
    expect(a4.to.pin).toBe(result.decisionById["APP-004"].allocation!.pin);
    expect(a4.bearing).toBeGreaterThanOrEqual(0);
    expect(a4.bearing).toBeLessThan(360);
    expect(m.origins.map((o) => o.id)).toContain("APP-004");
  });

  it("shows waitlist, hold and rejected applicants as grey dots at the pin they applied for, and can hide them", () => {
    const withWaiting = buildMapModel(result, A, { city: null, showWaiting: true });
    const grey = result.decisions.filter((d) => !d.allocation && d.pin && /^\d{6}$/.test(d.pin));
    expect(withWaiting.waiting.length).toBeGreaterThan(5);
    expect(withWaiting.waiting.every((w) => ["WAITLIST", "HOLD", "REJECTED"].includes(w.status))).toBe(true);
    expect(withWaiting.waiting.length).toBeLessThanOrEqual(grey.length);
    expect(buildMapModel(result, A, { city: null, showWaiting: false }).waiting).toEqual([]);
  });

  it("filters by city", () => {
    const m = buildMapModel(result, A, { city: "Belagavi", showWaiting: true });
    expect(m.stores.map((s) => s.id)).toEqual(["ST-10"]);
    expect([...m.allocations, ...m.waiting].every((x) => x.city === "Belagavi")).toBe(true);
  });

  it("an applicant with a pin that isn't valid (APP-029, '5700') is simply left off the map", () => {
    const m = buildMapModel(result, A);
    expect([...m.allocations, ...m.waiting].some((x) => x.id === "APP-029")).toBe(false);
  });

  it("allPoints covers every marker, so the view can fit them", () => {
    const m = buildMapModel(result, A, { city: "Bengaluru", showWaiting: true });
    expect(allPoints(m).length).toBe(m.stores.length + m.allocations.length + m.waiting.length + m.origins.length);
  });
});

describe("focus model (the drawer's mini-map)", () => {
  it("shows a redirected applicant's two pins, the arrow, and the stores near either", () => {
    const m = buildFocusModel(result, A, "APP-004")!;
    expect(m.allocations.map((a) => a.id)).toEqual(["APP-004"]);
    expect(m.arrows).toHaveLength(1);
    expect(m.origins).toHaveLength(1);
    expect(m.stores.map((s) => s.id)).toContain("ST-03"); // the store that blocked the pin they applied for
  });
  it("shows an unplaced applicant's own pin as a grey dot", () => {
    const m = buildFocusModel(result, A, "APP-012")!;
    expect(m.allocations).toEqual([]);
    expect(m.waiting.map((w) => w.id)).toEqual(["APP-012"]);
  });
  it("has nothing to draw for someone with no pin, or an unknown ID", () => {
    expect(buildFocusModel(result, A, "APP-029")).toBeNull();
    expect(buildFocusModel(result, A, "APP-999")).toBeNull();
  });
});

describe("geometry helpers", () => {
  it("bearing points the arrowhead the right way", () => {
    const o = { lat: 12.9, lng: 77.6 };
    expect(bearingDeg(o, { lat: 13.0, lng: 77.6 })).toBeCloseTo(0, 0);
    expect(bearingDeg(o, { lat: 12.9, lng: 77.7 })).toBeCloseTo(90, 0);
    expect(bearingDeg(o, { lat: 12.8, lng: 77.6 })).toBeCloseTo(180, 0);
    expect(bearingDeg(o, { lat: 12.9, lng: 77.5 })).toBeCloseTo(270, 0);
  });
  it("spread fans out markers that share a pin, and leaves single markers alone", () => {
    const base = { lat: 12.9, lng: 77.6, pin: "560001" };
    const out = spread([{ id: "APP-2", ...base }, { id: "APP-1", ...base }, { id: "APP-3", lat: 13, lng: 77.7, pin: "560002" }]);
    const same = out.filter((o) => o.pin === "560001");
    expect(new Set(same.map((o) => `${o.lat.toFixed(6)},${o.lng.toFixed(6)}`)).size).toBe(2);
    expect(out.find((o) => o.id === "APP-3")).toMatchObject({ lat: 13, lng: 77.7 });
    const again = spread([{ id: "APP-1", ...base }, { id: "APP-2", ...base }]);
    const byId = (xs: typeof out) => Object.fromEntries(xs.filter((x) => x.pin === "560001").map((x) => [x.id, [x.lat, x.lng]]));
    expect(byId(again)).toEqual(byId(out)); // same positions whatever order they arrive in
  });
});
