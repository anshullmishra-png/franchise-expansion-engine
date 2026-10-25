import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS as A } from "../../lib/engine/assumptions";
import {
  catchmentRadiusKm, coordsOf, distanceKm, haversineKm, overlapBand, overlapBetweenPins, overlapPctAt, safetyPoints,
} from "../../lib/engine/geo";

describe("haversine and distances", () => {
  it("560001 to 560038 is about 4.5 km", () => {
    expect(distanceKm("560001", "560038")!).toBeGreaterThan(4.2);
    expect(distanceKm("560001", "560038")!).toBeLessThan(4.8);
  });
  it("is zero for the same point and symmetric", () => {
    const a = { lat: 12.97, lng: 77.59 };
    const b = { lat: 12.3, lng: 76.64 };
    expect(haversineKm(a, a)).toBe(0);
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
    expect(distanceKm("560095", "570001")).toBeCloseTo(distanceKm("570001", "560095")!, 9);
  });
  it("uses the city centre for a valid-prefix pin that isn't on file, and null for a foreign pin", () => {
    expect(coordsOf("560999")?.approximate).toBe(true);
    expect(coordsOf("560001")?.approximate).toBe(false);
    expect(coordsOf("400001")).toBeNull();
    expect(distanceKm("560001", "400001")).toBeNull();
  });
});

describe("catchment overlap", () => {
  it("is 100% at distance 0 and 0% at or beyond 2r", () => {
    expect(overlapPctAt(0, 2)).toBe(100);
    expect(overlapPctAt(4, 2)).toBe(0);
    expect(overlapPctAt(7, 2)).toBe(0);
  });
  it("matches the lens formula (d = r gives about 39.1%)", () => {
    expect(overlapPctAt(2, 2)).toBeCloseTo(39.1, 1);
  });
  it("falls steadily as the pins move apart", () => {
    let prev = 101;
    for (let d = 0; d <= 4; d += 0.25) {
      const v = overlapPctAt(d, 2);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });
  it("is symmetric between pins, 100 for the same pin", () => {
    expect(overlapBetweenPins("560095", "560071", 2)).toBeCloseTo(overlapBetweenPins("560071", "560095", 2), 9);
    expect(overlapBetweenPins("560095", "560095", 2)).toBe(100);
  });
  it("treats unknown geography as no overlap (such pins are never allocated)", () => {
    expect(overlapBetweenPins("560001", "400001", 2)).toBe(0);
  });
  it("uses the tier radius from the assumptions", () => {
    expect(catchmentRadiusKm(1, A)).toBe(2);
    expect(catchmentRadiusKm(2, A)).toBe(3);
    expect(catchmentRadiusKm(3, A)).toBe(5);
  });
  it("bands and safety points follow SPEC §4/§5.4 exactly", () => {
    const at = (p: number) => [overlapBand(p, A), safetyPoints(p, A)];
    expect(at(0)).toEqual(["Low", 10]);
    expect(at(9.99)).toEqual(["Low", 10]);
    expect(at(10)).toEqual(["Moderate", 7]);
    expect(at(24.99)).toEqual(["Moderate", 7]);
    expect(at(25)).toEqual(["Elevated", 3]);
    expect(at(44.99)).toEqual(["Elevated", 3]);
    expect(at(45)).toEqual(["Blocked", 0]);
    expect(at(100)).toEqual(["Blocked", 0]);
  });
  it("known stress-file geometry: 570001 and 570004 are blocked at the Tier 2 radius, 560095 and 560008 aren't", () => {
    expect(overlapBetweenPins("570001", "570004", 3)).toBeGreaterThanOrEqual(45);
    expect(overlapBetweenPins("560095", "560008", 2)).toBeLessThan(10);
  });
});
