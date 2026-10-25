import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS as A } from "../../lib/engine/assumptions";
import { allocate, compareCandidates, type Candidate } from "../../lib/engine/allocate";
import { catchmentRadiusKm } from "../../lib/engine/geo";
import { DEFAULT_EXISTING_STORES } from "../../lib/engine/reference";
import type { Territory, Tier } from "../../lib/engine/types";
import { mkTer } from "../helpers/fixtures";

const BLR = {
  A: mkTer({ id: "TER-A", pins: ["560095", "560008", "560071", "560017", "560048"], openSlots: 2 }),
  B: mkTer({ id: "TER-B", pins: ["560067", "560048"], openSlots: 1, priority: "Medium" }),
};

function cand(over: Partial<Candidate> & { id: string; pin: string }, territory: Territory | null, tier: Tier = 1): Candidate {
  return {
    person: over.id.toLowerCase(),
    score: 80,
    effectiveScore: over.score ?? 80,
    financialPoints: 19,
    realisticMonths: 2.5,
    city: "Bengaluru",
    tier,
    radiusKm: catchmentRadiusKm(tier, A),
    ownTerritory: territory,
    ...over,
  };
}

const run = (candidates: Candidate[], territories: Territory[]) =>
  allocate({ candidates, territories, stores: DEFAULT_EXISTING_STORES, assumptions: A });
const at = (r: ReturnType<typeof run>, id: string) => r.placements.find((p) => p.applicationId === id);

describe("ordering and tie-breaks", () => {
  const base = cand({ id: "APP-010", pin: "560095" }, BLR.A);
  it("higher effective score first", () => {
    expect(compareCandidates({ ...base, effectiveScore: 90 }, { ...base, id: "APP-011", effectiveScore: 80 })).toBeLessThan(0);
  });
  it("then higher financial points, then earlier realistic launch, then ID", () => {
    const b = { ...base, id: "APP-011" };
    expect(compareCandidates({ ...base, financialPoints: 25 }, b)).toBeLessThan(0);
    expect(compareCandidates({ ...base, realisticMonths: 2.5 }, { ...b, realisticMonths: 4 })).toBeLessThan(0);
    expect(compareCandidates(base, b)).toBeLessThan(0);
    expect(compareCandidates({ ...base, id: "APP-100" }, { ...b, id: "APP-20" })).toBeGreaterThan(0);
  });
  it("the higher scorer gets the single slot, the other is unplaced", () => {
    const t = mkTer({ id: "TER-X", pins: ["560095"], openSlots: 1 });
    const r = run([cand({ id: "APP-1", pin: "560095", score: 70 }, t), cand({ id: "APP-2", pin: "560095", score: 75 }, t)], [t]);
    expect(at(r, "APP-2")?.kind).toBe("own");
    expect(at(r, "APP-1")).toBeUndefined();
    expect(r.unplaced.map((u) => u.applicationId)).toEqual(["APP-1"]);
  });
  it("a tie on score goes to the better financial readiness", () => {
    const t = mkTer({ id: "TER-X", pins: ["560095"], openSlots: 1 });
    const r = run([cand({ id: "APP-1", pin: "560095", financialPoints: 12 }, t), cand({ id: "APP-2", pin: "560095", financialPoints: 22 }, t)], [t]);
    expect(at(r, "APP-2")).toBeDefined();
  });
});

describe("pass 1: own territory", () => {
  it("gives the applicant their own pin when it is viable and a slot is free", () => {
    const r = run([cand({ id: "APP-1", pin: "560095" }, BLR.A)], [BLR.A]);
    expect(at(r, "APP-1")).toMatchObject({ kind: "own", pin: "560095", territoryId: "TER-A" });
  });
  it("redirects within the territory when the own pin was taken (H2), choosing the least overlap", () => {
    const r = run([cand({ id: "APP-1", pin: "560095", score: 90 }, BLR.A), cand({ id: "APP-2", pin: "560095", score: 80 }, BLR.A)], [BLR.A]);
    const p = at(r, "APP-2")!;
    expect(p).toMatchObject({ kind: "redirect", territoryId: "TER-A", sameTerritory: true, from: { territoryId: "TER-A", pin: "560095" } });
    expect(p.pin).not.toBe("560095");
    expect(r.traces.get("APP-2")!.some((s) => s.kind === "own-pin-taken" && s.by === "APP-1")).toBe(true);
  });
  it("never uses a pin that already has an existing store (H1), even if it is the applicant's own", () => {
    const t = mkTer({ id: "TER-X", pins: ["560038", "560017"], openSlots: 2 });
    const r = run([cand({ id: "APP-1", pin: "560038" }, t)], [t]);
    expect(at(r, "APP-1")?.pin).toBe("560017");
    expect(at(r, "APP-1")?.kind).toBe("redirect");
    expect(r.traces.get("APP-1")!.some((s) => s.kind === "own-pin-overlap" || s.kind === "own-pin-store")).toBe(true);
  });
  it("blocks a pin whose catchment overlaps an existing store by 45% or more (560008 is 1.7 km from ST-03)", () => {
    const t = mkTer({ id: "TER-X", pins: ["560008", "560095"], openSlots: 1 });
    const r = run([cand({ id: "APP-1", pin: "560008" }, t)], [t]);
    expect(at(r, "APP-1")?.pin).toBe("560095");
  });
  it("blocks a pin 45%+ overlapping a store placed earlier (H5, new vs new)", () => {
    const t2 = (slots: number) => mkTer({ id: "TER-M", city: "Mysuru", pins: ["570001", "570004", "570014", "570020"], openSlots: slots, tier: 2, statedTier: 2 });
    const T = t2(2);
    const mk = (id: string, pin: string, score: number) => cand({ id, pin, score, city: "Mysuru" }, T, 2);
    const r = run([mk("APP-8", "570001", 85), mk("APP-9", "570004", 80)], [T]);
    expect(at(r, "APP-8")?.pin).toBe("570001");
    expect(at(r, "APP-9")).toBeUndefined();
    expect(r.traces.get("APP-9")!.some((s) => s.kind === "own-pin-overlap-new" && s.with === "APP-8")).toBe(true);
  });
  it("respects the open-slot limit (H3) and never places in a zero-slot territory (H4)", () => {
    const zero = mkTer({ id: "TER-0", pins: ["560095"], openSlots: 0 });
    expect(run([cand({ id: "APP-1", pin: "560095" }, zero)], [zero]).placements).toEqual([]);
    const one = mkTer({ id: "TER-1", pins: ["560095", "560071", "560017"], openSlots: 1 });
    const r = run([cand({ id: "APP-1", pin: "560095" }, one), cand({ id: "APP-2", pin: "560071" }, one), cand({ id: "APP-3", pin: "560017" }, one)], [one]);
    expect(r.placements).toHaveLength(1);
  });
  it("a negative or missing slot count means no slots", () => {
    const neg = mkTer({ id: "TER-N", pins: ["560095"], openSlots: -3 });
    const nul = mkTer({ id: "TER-U", pins: ["560071"], openSlots: null });
    expect(run([cand({ id: "APP-1", pin: "560095" }, neg), cand({ id: "APP-2", pin: "560071" }, nul)], [neg, nul]).placements).toEqual([]);
  });
});

describe("pass 2: other territories in the same city", () => {
  it("runs after every own-territory placement, so a lower scorer keeps the own pin they can win", () => {
    const full = mkTer({ id: "TER-F", pins: ["560095"], openSlots: 1 });
    const other = mkTer({ id: "TER-O", pins: ["560067", "560048"], openSlots: 2, priority: "Medium" });
    const r = run(
      [cand({ id: "APP-1", pin: "560095", score: 90 }, full), cand({ id: "APP-2", pin: "560095", score: 85 }, full), cand({ id: "APP-3", pin: "560067", score: 60 }, other)],
      [full, other]
    );
    expect(at(r, "APP-3")).toMatchObject({ kind: "own", pin: "560067" });
    expect(at(r, "APP-2")).toMatchObject({ kind: "redirect", sameTerritory: false, from: { territoryId: "TER-F", pin: "560095" } });
    expect(at(r, "APP-2")!.territoryId).toBe("TER-O");
  });
  it("picks the pin closest to the applicant's own", () => {
    const full = mkTer({ id: "TER-F", pins: ["560095"], openSlots: 0 });
    const near = mkTer({ id: "TER-N", pins: ["560071"], openSlots: 1 });
    const far = mkTer({ id: "TER-R", pins: ["560067"], openSlots: 1 });
    const r = run([cand({ id: "APP-1", pin: "560095" }, full)], [full, far, near]);
    expect(at(r, "APP-1")?.pin).toBe("560071");
  });
  it("handles an applicant whose pin is in no territory", () => {
    const t = mkTer({ id: "TER-T", pins: ["560071", "560067"], openSlots: 1 });
    const r = run([cand({ id: "APP-1", pin: "560100" }, null)], [t]);
    expect(at(r, "APP-1")).toMatchObject({ kind: "redirect", from: { territoryId: null, pin: "560100" } });
    expect(r.traces.get("APP-1")!.some((s) => s.kind === "no-territory")).toBe(true);
  });
  it("never crosses cities", () => {
    const mysuru = mkTer({ id: "TER-M", city: "Mysuru", pins: ["570014"], openSlots: 1, tier: 2 });
    const full = mkTer({ id: "TER-F", pins: ["560095"], openSlots: 0 });
    const r = run([cand({ id: "APP-1", pin: "560095" }, full)], [full, mysuru]);
    expect(r.placements).toEqual([]);
    expect(r.traces.get("APP-1")!.some((s) => s.kind === "no-free-slot-in-city")).toBe(true);
  });
  it("reports who held the territory's slots", () => {
    const t = mkTer({ id: "TER-X", pins: ["560095", "560008"], openSlots: 1 });
    const r = run([cand({ id: "APP-1", pin: "560095", score: 90 }, t), cand({ id: "APP-2", pin: "560008", score: 80 }, t)], [t]);
    const step = r.traces.get("APP-2")!.find((s) => s.kind === "territory-full");
    expect(step).toMatchObject({ territoryId: "TER-X", heldBy: ["APP-1"] });
  });
});

describe("one store per person (H6)", () => {
  it("places the higher-ranked row and skips the other, with the reason", () => {
    const t = mkTer({ id: "TER-X", pins: ["560095", "560008"], openSlots: 2 });
    const r = run(
      [cand({ id: "APP-3", pin: "560095", score: 84, person: "arjun reddy" }, t), cand({ id: "APP-35", pin: "560008", score: 88, person: "arjun reddy" }, t)],
      [t]
    );
    expect(at(r, "APP-35")).toBeDefined();
    expect(at(r, "APP-3")).toBeUndefined();
    expect(r.unplaced).toEqual([{ applicationId: "APP-3", reason: "same-person" }]);
    expect(r.traces.get("APP-3")!).toContainEqual({ kind: "same-person", other: "APP-35" });
  });
});

describe("determinism", () => {
  it("gives the same result whatever order the candidates arrive in", () => {
    const cands = [
      cand({ id: "APP-1", pin: "560095", score: 80 }, BLR.A),
      cand({ id: "APP-2", pin: "560095", score: 80 }, BLR.A),
      cand({ id: "APP-3", pin: "560008", score: 80 }, BLR.A),
      cand({ id: "APP-4", pin: "560067", score: 70 }, BLR.B),
    ];
    const a = run(cands, [BLR.A, BLR.B]).placements;
    const b = run([...cands].reverse(), [BLR.B, BLR.A]).placements;
    expect(b).toEqual(a);
  });
});
