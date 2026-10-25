import { describe, expect, it } from "vitest";
import pinData from "../../data/karnataka_pins.json";
import { DEFAULT_ASSUMPTIONS, runEngine } from "../../lib/engine";
import { parseWorkbook } from "../../lib/engine/parse";
import { DEFAULT_EXISTING_STORES } from "../../lib/engine/reference";
import { STATUSES, type Overrides } from "../../lib/engine/types";
import { APP_HEADERS, TER_HEADERS, makeWorkbook, toBytes, type Cell } from "../helpers/workbook";

// Invariant fuzzing (SPEC §10.2): 300 random, messy workbooks. The engine must never throw, every
// applicant must get exactly one status with an explanation, and rules H1-H6 must hold. The checks
// below are written independently of the engine's own invariant checker.

const WORKBOOKS = 300;
const TODAY = "2026-10-25";

// Small seeded PRNG so a failure can be replayed by seed.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIN_FILE = (pinData as unknown as { pins: Record<string, { city: string }> }).pins;
const CITIES = ["Bengaluru", "Mysuru", "Mangaluru", "Hubballi-Dharwad", "Belagavi", "Tumakuru", "Davanagere"];
const PIN_BY_CITY: Record<string, string[]> = {};
for (const [pin, v] of Object.entries(PIN_FILE)) (PIN_BY_CITY[v.city] ??= []).push(pin);
const STORE_PINS = DEFAULT_EXISTING_STORES.map((s) => s.pin);
const NAMES = ["Asha Rao", "Ravi Kumar", "Priya Sharma", "Arjun Reddy", "Pooja Menon", "Imran Khan", "Sunita Pai", "Basavaraj H", "Meera Joshi", "Karthik Gowda", "Anil Shetty", "Deepa N"];
const BUSINESS = ["", "Runs a footwear store", "Optical shop owner", "IT professional", "Runs a bakery", "Store manager at an apparel chain", "Franchise of a mobile accessories brand", "Hardware store", "retired"];
const NOTES = ["", "", "Please open before Diwali", "Need a bank loan for part of it", "Investment of about 30 lakh from my savings", "Near Devaraja Market", "We may withdraw if the loan isn't approved", "A ground-floor shop is likely to be vacant in January"];

function generate(seed: number) {
  const rnd = mulberry32(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const chance = (p: number) => rnd() < p;
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

  const pinFor = (city: string): Cell => {
    const r = rnd();
    if (r < 0.62) return pick(PIN_BY_CITY[city] ?? STORE_PINS);
    if (r < 0.77) return pick(STORE_PINS);
    if (r < 0.82) return null;
    if (r < 0.87) return String(int(1000, 99999));
    if (r < 0.9) return "56OO95";
    if (r < 0.94) return `${pick(PIN_BY_CITY[city] ?? STORE_PINS)}.0`;
    if (r < 0.97) return pick(PIN_BY_CITY[pick(CITIES)]);
    return 400001;
  };

  const nApps = int(0, 40);
  const apps: Cell[][] = [];
  for (let i = 0; i < nApps; i++) {
    if (chance(0.06)) {
      apps.push([]);
      continue;
    }
    const city = chance(0.04) ? "Pune" : pick(CITIES);
    const id = chance(0.03) ? "" : chance(0.04) && i > 0 ? `APP-${String(int(1, i)).padStart(3, "0")}` : `APP-${String(i + 1).padStart(3, "0")}`;
    apps.push([
      id,
      chance(0.06) ? "" : pick(NAMES),
      city,
      chance(0.05) ? "Kerala" : "Karnataka",
      pinFor(city),
      chance(0.05) ? null : chance(0.05) ? 300 : chance(0.04) ? "25,00,000" : chance(0.03) ? "lots" : int(8, 80),
      chance(0.05) ? null : int(0, 14),
      pick(BUSINESS),
      chance(0.05) ? null : pick(["Owned", "Rented", "Not yet identified", "rented", "maybe"]),
      chance(0.25) ? null : int(150, 1800),
      chance(0.1) ? null : pick(["Ground", "Upper", "Mall unit", "Not known", "ground floor", "rooftop"]),
      chance(0.1) ? null : int(0, 15),
      pick(["Kannada", "English", "Hindi", "", "Tamil"]),
      pick(NOTES),
    ]);
  }

  const nTer = int(0, 10);
  const territories: Cell[][] = [];
  for (let i = 0; i < nTer; i++) {
    const city = pick(CITIES);
    const pool = [...(PIN_BY_CITY[city] ?? [])];
    const pins: string[] = [];
    const k = int(0, 7);
    for (let j = 0; j < k && pool.length; j++) pins.push(pool.splice(int(0, pool.length - 1), 1)[0]);
    if (chance(0.4)) pins.push(pick(STORE_PINS));
    if (chance(0.15) && territories.length) pins.push(String(territories[0][3] ?? "").split(",")[0].trim());
    if (chance(0.05)) pins.push("12345");
    territories.push([
      chance(0.05) ? `TER-${String(int(1, Math.max(1, i))).padStart(2, "0")}` : `TER-${String(i + 1).padStart(2, "0")}`,
      city,
      "Karnataka",
      pins.join(chance(0.2) ? "; " : ", "),
      pick(["Tier 1", "Tier 2", "Tier 3", "", "Tier 9"]),
      chance(0.08) ? null : chance(0.05) ? -1 : chance(0.15) ? 0 : int(1, 3),
      pick(["High", "Medium", "Low", "", "Urgent"]),
    ]);
  }

  const overrides: Overrides = {};
  if (nApps && chance(0.5)) {
    const row = apps.find((r) => r.length && r[0]);
    if (row) {
      const id = String(row[0]);
      overrides.applications = { [id]: { floor: "Ground", spaceAvailable: "Identified (ownership unconfirmed)", investmentLakh: int(10, 60) } };
      if (chance(0.5)) overrides.withdrawn = { [id]: "test" };
    }
  }
  if (nTer && chance(0.4)) overrides.territories = { [String(territories[0][0])]: { openSlots: int(0, 4) } };

  const wb = makeWorkbook({
    applications: { headers: APP_HEADERS, rows: apps },
    territories: { headers: TER_HEADERS, rows: territories },
    stores: chance(0.7) ? { headers: ["Store ID", "City", "Pin code", "Opened (year)"], rows: DEFAULT_EXISTING_STORES.map((s) => [s.id, s.city, Number(s.pin), s.openedYear]) } : null,
  });
  return { bytes: toBytes(wb), overrides };
}

describe(`invariant fuzzing: ${WORKBOOKS} random workbooks`, () => {
  it("never throws, always explains, and never breaks a placement rule", () => {
    let withPlacements = 0;
    let holds = 0;
    for (let seed = 1; seed <= WORKBOOKS; seed++) {
      const { bytes, overrides } = generate(seed);
      const where = `seed ${seed}`;

      const parsed = parseWorkbook(bytes);
      expect(parsed.ok, where).toBe(true);

      // Throw on violation is on by default in tests, so a broken rule fails here with its message.
      const res = runEngine(parsed.input, DEFAULT_ASSUMPTIONS, overrides, { today: TODAY });

      // Independent checks of H1-H6 on the final allocation
      const placed = res.decisions.filter((d) => d.allocation);
      if (placed.length) withPlacements++;
      const pins = placed.map((d) => d.allocation!.pin);
      expect(new Set(pins).size, `${where}: H2 shared pin`).toBe(pins.length); // H2
      for (const p of pins) expect(STORE_PINS.includes(p) && res.input.existingStores.some((s) => s.pin === p), `${where}: H1 ${p}`).toBe(false); // H1
      for (const t of res.territories) {
        expect(t.allocated.length, `${where}: H3 ${t.id}`).toBeLessThanOrEqual(Math.max(0, t.openSlots)); // H3
        if (t.allocated.length) expect(t.openSlots, `${where}: H4 ${t.id}`).toBeGreaterThan(0); // H4
      }
      const people = placed.map((d) => (d.name ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
      expect(new Set(people).size, `${where}: H6 person`).toBe(people.length); // H6
      expect(res.invariants, where).toMatchObject({ ok: true, violations: [] }); // H5 and the rest, by the engine's checker

      // Every applicant: exactly one status and a full explanation
      expect(res.decisions.length, where).toBe(parsed.input.applications.length);
      const ids = res.decisions.map((d) => d.id);
      expect(new Set(ids).size, `${where}: unique ids`).toBe(ids.length);
      for (const dec of res.decisions) {
        expect(STATUSES, where).toContain(dec.status);
        expect(dec.headline.length, `${where} ${dec.id} headline`).toBeGreaterThan(3);
        expect(dec.why.length, `${where} ${dec.id} why`).toBeGreaterThan(10);
        expect(dec.reasons.length, `${where} ${dec.id} reasons`).toBeGreaterThan(0);
        if (dec.status === "HOLD") {
          holds++;
          expect(dec.allocation, `${where} ${dec.id} hold`).toBeUndefined();
          expect(dec.questionsForApplicant?.length ?? 0, `${where} ${dec.id} questions`).toBeGreaterThan(0);
        }
        if (dec.status === "APPROVED" || dec.status === "CONDITIONAL" || dec.status === "REDIRECT") {
          expect(dec.allocation, `${where} ${dec.id} allocation`).toBeDefined();
          expect(dec.score, `${where} ${dec.id} score`).not.toBeNull();
        } else {
          expect(dec.allocation, `${where} ${dec.id} none`).toBeUndefined();
        }
        if (dec.score !== null) {
          expect(dec.score).toBeGreaterThanOrEqual(0);
          expect(dec.score).toBeLessThanOrEqual(100);
        }
      }
      expect(Object.values(res.counts).reduce((s, n) => s + n, 0), where).toBe(res.decisions.length);

      // Deterministic
      if (seed % 10 === 0) {
        const again = runEngine(parsed.input, DEFAULT_ASSUMPTIONS, overrides, { today: TODAY });
        expect(again.decisions.map((d) => [d.id, d.status, d.score, d.allocation?.pin]), where).toEqual(
          res.decisions.map((d) => [d.id, d.status, d.score, d.allocation?.pin])
        );
      }
    }
    // The generator really does exercise allocation and holds
    expect(withPlacements).toBeGreaterThan(WORKBOOKS * 0.4);
    expect(holds).toBeGreaterThan(100);
  }, 120_000);
});
