import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runEngine } from "../../lib/engine";
import { parseWorkbook } from "../../lib/engine/parse";
import { distanceKm } from "../../lib/engine/geo";
import { DEFAULT_EXISTING_STORES } from "../../lib/engine/reference";
import type { Decision } from "../../lib/engine/types";

// P3 "Done when": every stress applicant has a complete Decision record; explanations read naturally and
// contain the deciding numbers; APP-012 shows the "~74 if they find a ground-floor space" line.

const TODAY = "2026-10-25";
const parsed = parseWorkbook(readFileSync(path.join(process.cwd(), "test-data/Stress_Test_Case1.xlsx")));
const res = runEngine(parsed.input, undefined, undefined, { today: TODAY });
const d = (id: string): Decision => res.decisionById[id];
const moving = res.decisions.filter((x) => ["APPROVED", "CONDITIONAL", "REDIRECT"].includes(x.status));

describe("every stress applicant has a complete record", () => {
  it("status, headline, why and reasons for all 34", () => {
    expect(res.decisions).toHaveLength(34);
    for (const x of res.decisions) {
      expect(x.headline.length, x.id).toBeGreaterThan(5);
      expect(x.why.length, x.id).toBeGreaterThan(40);
      expect(x.reasons.length, x.id).toBeGreaterThan(0);
    }
  });
  it("moving applicants have 3-6 next steps, a dated timeline and a training plan", () => {
    expect(moving.length).toBeGreaterThan(10);
    for (const x of moving) {
      expect(x.nextSteps!.length, x.id).toBeGreaterThanOrEqual(3);
      expect(x.nextSteps!.length, x.id).toBeLessThanOrEqual(6);
      for (const s of x.nextSteps!) {
        expect(s.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(s.due >= TODAY, `${x.id} ${s.text}`).toBe(true);
      }
      expect(x.readinessPlan?.indicative, x.id).toBe(false);
      expect(x.readinessPlan!.timeline.find((b) => b.key === "opening")!.start, x.id).toBe(x.plannedOpenDate);
      expect(x.readinessPlan!.training.shadowing, x.id).not.toBeNull();
      expect(x.readinessPlan!.training.totalDays, x.id).toBeGreaterThanOrEqual(11);
      expect(x.plannedOpenDate! > TODAY, x.id).toBe(true);
    }
  });
  it("timelines are internally consistent for everyone", () => {
    for (const x of moving) {
      const t = Object.fromEntries(x.readinessPlan!.timeline.map((b) => [b.key, b]));
      expect(t["soft-launch"].end, x.id).toBe(t.opening.start);
      expect(t.fitout.end, x.id).toBe(t["soft-launch"].start);
      expect(t["partner-training"].end < t["staff-training"].start, x.id).toBe(true);
      expect(t["staff-training"].end < t["soft-launch"].start, x.id).toBe(true);
      for (const b of x.readinessPlan!.timeline) expect(b.end >= b.start, `${x.id} ${b.key}`).toBe(true);
    }
  });
  it("every held applicant has questions; every non-moving, non-withdrawn applicant has a 'what would change it'", () => {
    for (const x of res.decisions) {
      if (x.status === "HOLD") expect(x.questionsForApplicant!.length, x.id).toBeGreaterThan(0);
      if (!moving.includes(x)) expect(x.whatWouldChange, x.id).toBeTruthy();
      else expect(x.whatWouldChange, x.id).toBeUndefined();
    }
  });
  it("waitlisted applicants have an indicative training plan; held and rejected have no plan", () => {
    for (const x of res.decisions) {
      if (x.status === "WAITLIST") expect(x.readinessPlan?.indicative, x.id).toBe(true);
      if (x.status === "HOLD" || x.status === "REJECTED") expect(x.readinessPlan, x.id).toBeUndefined();
    }
  });
});

describe("explanations contain the deciding numbers", () => {
  it("APP-012: names the winner, both scores, and the ~74 line for a ground-floor space", () => {
    const w = d("APP-012");
    expect(w.status).toBe("WAITLIST");
    expect(w.why).toContain("APP-013 scored 68 against 66");
    expect(w.whatWouldChange).toMatch(/ground-floor space/);
    expect(w.whatWouldChange).toMatch(/rises from 66 to 74/);
    expect(w.whatWouldChange).toMatch(/moving APP-013 to waitlist #1/);
    expect(w.why).toContain(w.whatWouldChange!);
  });
  it("approved, conditional and redirected explanations quote the score and the closest existing store", () => {
    for (const x of moving) {
      expect(x.why, x.id).toContain(`${x.score}/100`);
      expect(x.why, x.id).toMatch(/Planned opening is around \d+ \w+ 20\d\d/);
    }
    for (const x of moving.filter((y) => y.status !== "REDIRECT")) expect(x.why, x.id).toMatch(/closest existing store/i);
  });
  it("APP-002 (approved): overlap with ST-02 is shown, not hidden", () => {
    expect(d("APP-002").why).toMatch(/ST-02/);
    expect(d("APP-002").cannibalisation[0]).toMatchObject({ storeId: "ST-02", kind: "existing" });
  });
  it("APP-004 (redirect): the 48% overlap with ST-03, the competitors, and the 8-point penalty", () => {
    expect(d("APP-004").why).toMatch(/48%/);
    expect(d("APP-004").why).toMatch(/ST-03/);
    expect(d("APP-004").why).toMatch(/8 points were deducted when ranking \(79 to 71\)/);
    expect(d("APP-004").why).toMatch(/APP-002 \(86\) ranked ahead/);
  });
  it("APP-009: loses to APP-008 on catchment overlap between two new stores", () => {
    expect(d("APP-009").why).toMatch(/APP-008/);
    expect(d("APP-009").why).toMatch(/49%|48%/);
  });
  it("APP-003 vs APP-035: same person, scores quoted", () => {
    expect(d("APP-003").why).toMatch(/APP-035 scored 88 against 84/);
  });
  it("APP-014: the 60% rule, the gap, and what a co-investor would do", () => {
    expect(d("APP-014").why).toMatch(/54%/);
    expect(d("APP-014").why).toMatch(/60%/);
    expect(d("APP-014").whatWouldChange).toMatch(/co-investor/);
    expect(d("APP-014").whatWouldChange).toMatch(/at the full ₹28 lakh/);
  });
  it("APP-030: the hold names both figures and simulates 30 lakh", () => {
    expect(d("APP-030").why).toMatch(/300 lakh|₹300 lakh/);
    expect(d("APP-030").whatWouldChange).toMatch(/investment is confirmed as ₹30 lakh, APP-030 would score 83 and be approved/);
  });
  it("APP-007: the hold says which city the pin belongs to and simulates the pin being right", () => {
    expect(d("APP-007").why).toMatch(/belongs to Bengaluru/);
    expect(d("APP-007").whatWouldChange).toMatch(/pin 560034 is confirmed/);
  });
  it("APP-024: the hold lists the differing figures", () => {
    expect(d("APP-024").why).toMatch(/investment \(lakh\): 35 vs 38/);
  });
  it("APP-008: says that Diwali can't be met and gives the realistic date", () => {
    expect(d("APP-008").why).toMatch(/Diwali|8 Nov 2026/);
    expect(d("APP-008").why).toMatch(/Planned opening is around 24 Jan 2027/);
  });
  it("APP-025: not ready ranking explained by components, no ranking penalty", () => {
    expect(d("APP-025").redirectPenaltyApplied).toBe(false);
    expect(d("APP-025").why.length).toBeGreaterThan(80);
  });
  it("APP-026: not forced into a free slot, with the score gap", () => {
    expect(d("APP-026").why).toMatch(/below the 55 needed/);
  });
});

describe("judge questions about onboarding", () => {
  it("'What does APP-008 need to do next?' has dated, owned steps", () => {
    const steps = d("APP-008").nextSteps!;
    expect(steps.map((s) => s.owner)).toEqual(expect.arrayContaining(["Partner", "Brand"]));
    expect(steps[0].text).toMatch(/letter of intent/);
    expect(steps.some((s) => /Site audit visit at 570001/.test(s.text))).toBe(true);
  });
  it("'How will APP-006 be trained?' answers with the extended plan in English at the nearest store", () => {
    const t = d("APP-006").readinessPlan!.training;
    expect(d("APP-006").status).toBe("WAITLIST");
    expect(t).toMatchObject({ language: "English", track: "extended" });
    expect(t.modules.some((m) => m.name === "Retail fundamentals bootcamp")).toBe(true);
    expect(t.shadowing).toMatchObject({ storeId: "ST-02", days: 10 });
    expect(t.buddy?.storeId).toBe("ST-02");
  });
  it("APP-015 (Hindi, zero experience, no business): extended plan in Hindi", () => {
    const t = d("APP-015").readinessPlan!.training;
    expect(t).toMatchObject({ language: "Hindi", track: "extended" });
    expect(t.materials).toContain("Hindi");
  });
  it("APP-017 (15 years, Tumakuru): fast-track, with a residential stint because the nearest store is far", () => {
    const t = d("APP-017").readinessPlan!.training;
    expect(t.track).toBe("fast-track");
    expect(t.shadowing?.residential).toBe(true);
    expect(t.shadowing!.km).toBeGreaterThan(40);
  });
  it("APP-019 (Davanagere): the residential stint is at ST-09 in Hubballi-Dharwad", () => {
    const sh = d("APP-019").readinessPlan!.training.shadowing!;
    expect(sh).toMatchObject({ storeId: "ST-09", residential: true });
    expect(sh.text).toMatch(/ST-09/);
  });
  it("training is at the store nearest the allocated pin, checked by brute force", () => {
    for (const x of moving) {
      const pin = x.allocation!.pin;
      const nearest = [...DEFAULT_EXISTING_STORES].sort((a, b) => (distanceKm(pin, a.pin) as number) - (distanceKm(pin, b.pin) as number))[0];
      expect(x.readinessPlan!.training.shadowing?.storeId, x.id).toBe(nearest.id);
    }
  });
  it("the language follows each applicant's preference", () => {
    for (const x of moving) {
      const app = res.input.applications.find((a) => a.id === x.id)!;
      expect(x.readinessPlan!.training.language).toBe(app.language ?? "English");
    }
  });
  it("redirected applicants get a site-at-the-new-pin condition and a shortlist", () => {
    for (const x of moving.filter((y) => y.status === "REDIRECT")) {
      expect(x.conditions?.some((c) => c.code === "SITE_AT_NEW_PIN"), x.id).toBe(true);
      expect(x.nextSteps!.some((s) => /Shortlist sites/.test(s.text)), x.id).toBe(true);
    }
  });
});

describe("simulations are honest", () => {
  it("what APP-012's text promises is what happens when the update is applied", () => {
    const after = runEngine(parsed.input, undefined, { applications: { "APP-012": { floor: "Ground", spaceAvailable: "Identified (ownership unconfirmed)" } } }, { today: TODAY });
    expect(after.decisionById["APP-012"].score).toBe(74);
    expect(after.decisionById["APP-012"].status).toBe("CONDITIONAL");
    expect(after.decisionById["APP-013"].waitlistRank).toMatchObject({ rank: 1, territoryId: "TER-07" });
  });
  it("what APP-030's text promises is what happens when the investment is corrected", () => {
    const after = runEngine(parsed.input, undefined, { applications: { "APP-030": { investmentLakh: 30 } } }, { today: TODAY });
    expect(after.decisionById["APP-030"]).toMatchObject({ status: "APPROVED", score: 83 });
  });
  it("what APP-014's text promises is what happens at the full need", () => {
    const after = runEngine(parsed.input, undefined, { applications: { "APP-014": { investmentLakh: 28 } } }, { today: TODAY });
    expect(after.decisionById["APP-014"]).toMatchObject({ status: "APPROVED", score: 74 });
  });
  it("the whole run, simulations included, stays fast", () => {
    const t0 = performance.now();
    runEngine(parsed.input, undefined, undefined, { today: TODAY });
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
