import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS as A } from "../../lib/engine/assumptions";
import { componentDiff } from "../../lib/engine/explain";
import { distanceKm } from "../../lib/engine/geo";
import { FAR_STORE_KM, buildNextSteps, buildTimeline, buildTrainingPlan, nearestStore } from "../../lib/engine/plan";
import { DEFAULT_EXISTING_STORES as STORES, addDaysISO } from "../../lib/engine/reference";
import { mergeOverrides } from "../../lib/engine/simulate";
import type { BusinessCategory, Condition, ScoreComponent } from "../../lib/engine/types";

const TODAY = "2026-10-25";

describe("nearest existing store", () => {
  it("is the minimum straight-line distance", () => {
    for (const pin of ["560095", "570001", "575003", "580021", "572101", "577002"]) {
      const brute = [...STORES].sort((a, b) => (distanceKm(pin, a.pin) as number) - (distanceKm(pin, b.pin) as number))[0];
      expect(nearestStore(pin, STORES)?.store.id).toBe(brute.id);
    }
  });
  it("breaks exact ties toward the lower store ID and ignores stores with no map position", () => {
    const twins = [
      { id: "ST-20", city: "Bengaluru", pin: "560001", openedYear: 2020 },
      { id: "ST-19", city: "Bengaluru", pin: "560001", openedYear: 2020 },
      { id: "ST-00", city: null, pin: "400001", openedYear: null },
    ];
    expect(nearestStore("560038", twins)?.store.id).toBe("ST-19");
    expect(nearestStore("560038", [twins[2]])).toBeNull();
  });
  it("names the area when the pin file has one", () => {
    expect(nearestStore("570001", STORES)).toMatchObject({ store: { id: "ST-06" }, area: expect.any(String) });
  });
});

describe("training plan (SPEC §7)", () => {
  const plan = (over: Partial<Parameters<typeof buildTrainingPlan>[0]> = {}) =>
    buildTrainingPlan({
      pin: "570001", language: "Kannada", experienceYears: 4, businessCategory: "specialty_retail" as BusinessCategory,
      stores: STORES, openDate: "2027-02-01", ...over,
    });
  const days = (p: ReturnType<typeof plan>, kind: string) => p.modules.filter((m) => m.kind === kind).reduce((s, m) => s + m.days, 0);

  it("standard: 8 core days plus 1 week of shadowing", () => {
    const p = plan();
    expect(p.track).toBe("standard");
    expect(days(p, "core")).toBe(8);
    expect(days(p, "bootcamp")).toBe(0);
    expect(p.shadowing).toMatchObject({ storeId: "ST-06", days: 5, residential: false });
    expect(p.totalDays).toBe(13);
  });
  it("extended: bootcamp (+5 days) and 2 weeks of shadowing for 0 or 1 years, or a non-retail background", () => {
    for (const over of [{ experienceYears: 0 }, { experienceYears: 1 }, { experienceYears: 6, businessCategory: "salaried_non_retail" as const }, { experienceYears: 6, businessCategory: "non_retail_business" as const }]) {
      const p = plan(over);
      expect(p.track).toBe("extended");
      expect(days(p, "bootcamp")).toBe(5);
      expect(p.shadowing?.days).toBe(10);
      expect(p.totalDays).toBe(23);
    }
  });
  it("fast-track: no bootcamp and shorter shadowing for 8+ years or a directly relevant category", () => {
    for (const over of [{ experienceYears: 8 }, { experienceYears: 3, businessCategory: "eyewear_optical_watches" as const }]) {
      const p = plan(over);
      expect(p.track).toBe("fast-track");
      expect(days(p, "bootcamp")).toBe(0);
      expect(p.shadowing?.days).toBe(3);
    }
  });
  it("new to retail wins over a relevant category", () => {
    expect(plan({ experienceYears: 0, businessCategory: "eyewear_optical_watches" }).track).toBe("extended");
  });
  it("is in the preferred language, defaulting to English with a note", () => {
    expect(plan({ language: "Hindi" }).materials).toContain("Hindi");
    expect(plan({ language: "Hindi" }).staffTraining.text).toContain("Hindi");
    const none = plan({ language: null });
    expect(none.language).toBe("English");
    expect(none.languageNote).toMatch(/English is assumed/);
    expect(plan().languageNote).toBeUndefined();
  });
  it("shadows at the nearest store, names it with its distance, and has that store's partner as the buddy", () => {
    const p = plan({ pin: "580021" });
    expect(p.shadowing?.storeId).toBe("ST-09");
    expect(p.shadowing?.km).toBeLessThan(FAR_STORE_KM);
    expect(p.shadowing?.text).toContain("ST-09");
    expect(p.buddy?.storeId).toBe("ST-09");
  });
  it("suggests a residential stint when the nearest store is far (Davanagere to Hubballi)", () => {
    const p = plan({ pin: "577002", language: "Hindi", experienceYears: 4 });
    expect(p.shadowing).toMatchObject({ storeId: "ST-09", residential: true, days: 5 });
    expect(p.shadowing?.km).toBeGreaterThan(FAR_STORE_KM);
    expect(p.shadowing?.text).toMatch(/residential/);
    expect(p.shadowing?.text).toMatch(/1-week/);
  });
  it("staff training is 5 days, 2 weeks before opening", () => {
    const p = plan({ openDate: "2027-02-01" });
    expect(p.staffTraining).toMatchObject({ days: 5, start: "2027-01-18" });
    expect(plan({ openDate: null }).staffTraining.start).toBe("");
  });
  it("copes with no store that has a map position, and stays category-neutral", () => {
    const p = plan({ stores: [] });
    expect(p.shadowing).toBeNull();
    expect(p.buddy).toBeNull();
    expect(JSON.stringify(plan())).not.toMatch(/eye|optic|lenskart/i);
  });
});

describe("timeline to opening", () => {
  const open = "2027-02-01";
  const bars = (over: Partial<Parameters<typeof buildTimeline>[0]> = {}) =>
    buildTimeline({ today: TODAY, open, floor: "Ground", conditions: [], partnerTrainingDays: 13, ...over });
  const by = (b: ReturnType<typeof bars>, key: string) => b.find((x) => x.key === key)!;

  it("lays out the SPEC §7 sequence", () => {
    const b = bars();
    expect(b.map((x) => x.key)).toEqual([
      "agreement", "licences", "fitout", "hiring", "partner-training", "staff-training", "soft-launch", "opening",
      "review-30", "review-60", "review-90",
    ]);
  });
  it("fit-out is 6 weeks (8 for a mall unit) and ends when the soft launch starts, a week before opening", () => {
    expect(by(bars(), "fitout")).toMatchObject({ end: addDaysISO(open, -7) });
    const days = (b: ReturnType<typeof bars>) => (Date.parse(by(b, "fitout").end) - Date.parse(by(b, "fitout").start)) / 86_400_000;
    expect(days(bars())).toBe(42);
    expect(days(bars({ floor: "Mall unit" }))).toBe(56);
    expect(by(bars(), "soft-launch")).toMatchObject({ start: addDaysISO(open, -7), end: open });
  });
  it("hiring starts 5 weeks before opening; staff training is 5 days starting 2 weeks before", () => {
    expect(by(bars(), "hiring").start).toBe(addDaysISO(open, -35));
    expect(by(bars(), "staff-training")).toMatchObject({ start: addDaysISO(open, -14), end: addDaysISO(open, -10) });
  });
  it("opening, then 30/60/90 day reviews", () => {
    expect(by(bars(), "opening")).toMatchObject({ start: open, end: open });
    expect(by(bars(), "review-30").start).toBe(addDaysISO(open, 30));
    expect(by(bars(), "review-60").start).toBe(addDaysISO(open, 60));
    expect(by(bars(), "review-90").start).toBe(addDaysISO(open, 90));
  });
  it("partner training finishes before staff training starts and begins after the agreement window", () => {
    const b = bars({ partnerTrainingDays: 23 });
    expect(by(b, "partner-training").end < by(b, "staff-training").start).toBe(true);
    expect(by(b, "partner-training").start >= by(b, "agreement").end).toBe(true);
  });
  it("every bar starts today or later and never ends before it starts", () => {
    for (const x of bars({ floor: "Mall unit", partnerTrainingDays: 23 })) {
      expect(x.start >= TODAY).toBe(true);
      expect(x.end >= x.start).toBe(true);
    }
  });
  it("adds a conditions window only when there are conditions, ending at the last deadline", () => {
    expect(bars().some((x) => x.key === "conditions")).toBe(false);
    const conditions: Condition[] = [
      { code: "FIND_SPACE", text: "a", deadline: "2026-11-24", owner: "Partner" },
      { code: "CONFIRM_SIZE", text: "b", deadline: "2026-11-08", owner: "Partner" },
    ];
    expect(by(bars({ conditions }), "conditions")).toMatchObject({ start: TODAY, end: "2026-11-24" });
  });
  it("still fits when opening is at the earliest realistic date (2.5 months)", () => {
    const b = buildTimeline({ today: TODAY, open: addDaysISO(TODAY, 76), floor: "Mall unit", conditions: [], partnerTrainingDays: 23 });
    expect(by(b, "fitout").start >= by(b, "agreement").end).toBe(true);
    expect(by(b, "fitout").end > by(b, "fitout").start).toBe(true);
  });
});

describe("next steps", () => {
  const cond = (code: Condition["code"], deadline: string, text: string = code): Condition => ({ code, text, deadline, owner: "Partner" });
  const steps = (over: Partial<Parameters<typeof buildNextSteps>[0]> = {}) =>
    buildNextSteps({ today: TODAY, conditions: [], shortlist: null, hasSite: true, siteLabel: "570001 (Mandimohalla)", ...over });

  it("has 3 to 6 steps, each with an owner and an ISO due date, sorted by date", () => {
    for (const s of [steps(), steps({ hasSite: false }), steps({ shortlist: ["560032", "560017"] })]) {
      expect(s.length).toBeGreaterThanOrEqual(3);
      expect(s.length).toBeLessThanOrEqual(6);
      for (const x of s) {
        expect(["Partner", "Brand"]).toContain(x.owner);
        expect(x.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(x.due >= TODAY).toBe(true);
      }
      expect(s.map((x) => x.due)).toEqual([...s.map((x) => x.due)].sort());
    }
  });
  it("starts with the letter of intent and KYC, then a site audit", () => {
    const s = steps();
    expect(s[0].text).toMatch(/letter of intent/);
    expect(s.some((x) => /KYC/.test(x.text))).toBe(true);
    expect(s.some((x) => /Site audit visit at 570001 \(Mandimohalla\)/.test(x.text) && x.owner === "Brand")).toBe(true);
  });
  it("includes each condition with its own deadline", () => {
    const s = steps({ conditions: [cond("FIND_SPACE", "2026-11-24", "Find a space."), cond("CONFIRM_SIZE", "2026-11-08", "Confirm the size.")] });
    expect(s.find((x) => x.text.includes("Confirm the size"))?.due).toBe("2026-11-08");
    expect(s.find((x) => x.text.includes("Find a space"))?.due).toBe("2026-11-24");
  });
  it("merges extra conditions so the list never goes past 6", () => {
    const many = ["a", "b", "c", "d", "e"].map((t, i) => cond("FIN_GAP", addDaysISO(TODAY, 10 + i), `Condition ${t}.`));
    const s = steps({ conditions: many });
    expect(s).toHaveLength(6);
    expect(s.some((x) => /remaining \d+ conditions/.test(x.text))).toBe(true);
  });
  it("for a redirect, shortlists sites at the new pins with area names and the reservation date", () => {
    const s = steps({ shortlist: ["560032", "560017"], slotReservedUntil: "24 Nov 2026" });
    const short = s.find((x) => /Shortlist sites/.test(x.text))!;
    expect(short.text).toContain("560032 (R T Nagar)");
    expect(short.text).toContain("560017");
    expect(short.text).toContain("24 Nov 2026");
    expect(short.owner).toBe("Partner");
  });
  it("without a site yet, the KYC step and site audit wait for a space", () => {
    const s = steps({ hasSite: false });
    expect(s.find((x) => /KYC/.test(x.text))!.text).toMatch(/once a space is found/);
    expect(s.some((x) => /once a space is identified/.test(x.text))).toBe(true);
  });
});

describe("explanation helpers", () => {
  const comp = (key: ScoreComponent["key"], points: number): ScoreComponent => ({ key, name: key === "signals" ? "AI-read signals" : `${key[0].toUpperCase()}${key.slice(1)} readiness`, points, max: 20, reason: "" });
  it("describes where one score is ahead and where it is behind, in words", () => {
    const text = componentDiff([comp("site", 18), comp("launch", 7), comp("financial", 12)], [comp("site", 6), comp("launch", 10), comp("financial", 12)]);
    expect(text).toBe("ahead on site readiness (+12), behind on launch readiness (-3)");
    expect(componentDiff([comp("site", 5)], [comp("site", 5)])).toBe("level on every component");
  });
});

describe("mergeOverrides", () => {
  it("merges per applicant and keeps both sides' facts", () => {
    const m = mergeOverrides(
      { applications: { "APP-1": { floor: "Ground" } }, withdrawn: { "APP-9": "x" }, resolved: { "APP-1": ["FIN_GAP"] } },
      { applications: { "APP-1": { spaceSize: 400 }, "APP-2": { floor: "Upper" } }, territories: { "TER-1": { openSlots: 2 } }, resolved: { "APP-1": ["FIN_GAP", "LOAN_DEPENDENT"] } }
    );
    expect(m.applications).toEqual({ "APP-1": { floor: "Ground", spaceSize: 400 }, "APP-2": { floor: "Upper" } });
    expect(m.withdrawn).toEqual({ "APP-9": "x" });
    expect(m.territories).toEqual({ "TER-1": { openSlots: 2 } });
    expect(m.resolved?.["APP-1"]).toEqual(["FIN_GAP", "LOAN_DEPENDENT"]);
  });
  it("does not mutate its inputs", () => {
    const a = { applications: { "APP-1": { floor: "Ground" as const } } };
    mergeOverrides(a, { applications: { "APP-1": { spaceSize: 400 } } });
    expect(a).toEqual({ applications: { "APP-1": { floor: "Ground" } } });
    expect(A.catchmentKm[1]).toBe(2);
  });
});
