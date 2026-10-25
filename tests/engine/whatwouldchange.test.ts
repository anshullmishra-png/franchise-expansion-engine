import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS, runEngine } from "../../lib/engine";
import type { Application, Overrides, Territory } from "../../lib/engine/types";
import { TODAY, mkApp, mkInput, mkTer } from "../helpers/fixtures";

const PINS = ["560095", "560017", "560048", "560067", "560041"];
const ter = (over: Partial<Territory> = {}) => mkTer({ id: "TER-A", pins: PINS, openSlots: 1, ...over });
const run = (apps: Application[], territories: Territory[] = [ter()], overrides: Overrides = {}, simulate = true) =>
  runEngine(mkInput(apps, territories), DEFAULT_ASSUMPTIONS, overrides, { today: TODAY, simulate });
const strong = (id: string, over: Partial<Application> = {}) => mkApp({ id, name: `Person ${id}`, ...over });

describe("what would change it", () => {
  it("is only produced for applicants who aren't moving forward", () => {
    const r = run([strong("APP-1"), strong("APP-2", { pin: "560017", investmentLakh: 30 }), strong("APP-3", { investmentLakh: 300 }), strong("APP-4", { investmentLakh: 10 })]);
    expect(r.decisionById["APP-1"].whatWouldChange).toBeUndefined();
    expect(r.decisionById["APP-2"].status).toBe("WAITLIST");
    for (const id of ["APP-2", "APP-3", "APP-4"]) expect(r.decisionById[id].whatWouldChange, id).toBeTruthy();
  });
  it("is left out for a withdrawn applicant, and when simulation is switched off", () => {
    const r = run([strong("APP-1")], [ter()], { withdrawn: { "APP-1": "gone" } });
    expect(r.decisionById["APP-1"].whatWouldChange).toBeUndefined();
    const off = run([strong("APP-1", { investmentLakh: 10 })], [ter()], {}, false);
    expect(off.decisionById["APP-1"].whatWouldChange).toBeUndefined();
    expect(off.decisionById["APP-1"].why.length).toBeGreaterThan(20);
  });

  it("waitlisted for want of a space: simulates a ground-floor space and names who gets bumped", () => {
    const holder = strong("APP-1", { name: "A One", pin: "560017", floor: "Upper", investmentLakh: 38 });
    const wanting = strong("APP-2", { name: "B Two", pin: "560095", spaceAvailable: "Not yet identified", spaceSize: null, floor: "Not known" });
    const r = run([holder, wanting]);
    const base = r.decisionById;
    expect(base["APP-1"].allocation).toBeDefined();
    expect(base["APP-2"].status).toBe("WAITLIST");
    const text = base["APP-2"].whatWouldChange!;
    expect(text).toMatch(/ground-floor space/);
    expect(text).toMatch(/score rises from \d+ to \d+/);
    expect(text).toMatch(/APP-2 would be (conditionally )?approved/);
    expect(text).toContain("moving APP-1");
    expect(base["APP-2"].why).toContain(text);
  });
  it("the simulated outcome matches what really happens when the change is applied", () => {
    const apps = [
      strong("APP-1", { name: "A One", pin: "560017", floor: "Upper", investmentLakh: 38 }),
      strong("APP-2", { name: "B Two", pin: "560095", spaceAvailable: "Not yet identified", spaceSize: null, floor: "Not known" }),
    ];
    const before = run(apps);
    const after = run(apps, [ter()], { applications: { "APP-2": { floor: "Ground", spaceAvailable: "Identified (ownership unconfirmed)" } } });
    const m = before.decisionById["APP-2"].whatWouldChange!.match(/rises from (\d+) to (\d+)/)!;
    expect(Number(m[1])).toBe(before.decisionById["APP-2"].score);
    expect(Number(m[2])).toBe(after.decisionById["APP-2"].score);
    expect(after.decisionById["APP-2"].allocation).toBeDefined();
    expect(after.decisionById["APP-1"].status).toBe("WAITLIST");
  });
  it("says so honestly when nothing quick would help", () => {
    const apps = [strong("APP-1", { pin: "560095" }), strong("APP-2", { name: "B Two", pin: "560095", investmentLakh: 38 })];
    const r = run(apps, [ter({ pins: ["560095"] })]);
    expect(r.decisionById["APP-2"].status).toBe("WAITLIST");
    expect(r.decisionById["APP-2"].whatWouldChange).toMatch(/Nothing the applicant can change quickly/);
  });
  it("not ready (score below 55): reports the score a fix would reach, and whether that is enough", () => {
    const weak = strong("APP-1", { investmentLakh: 22, experienceYears: 0, business: "IT job", spaceAvailable: "Not yet identified", spaceSize: null, floor: "Not known", targetLaunchMonths: 1 });
    const d = run([weak], [ter({ openSlots: 2 })]).decisionById["APP-1"];
    expect(d.status).toBe("WAITLIST");
    expect(d.whatWouldChange).toMatch(/ground-floor space|funding gap/);
  });
  it("same person: shows what happens if the other application is withdrawn, without calling the withdrawn one 'bumped'", () => {
    const a = strong("APP-1", { name: "Arjun Reddy", pin: "560095" });
    const b = strong("APP-2", { name: "Arjun Reddy", pin: "560017", investmentLakh: 38 });
    const r = run([a, b], [ter({ openSlots: 2 })]);
    const loser = r.decisions.find((d) => !d.allocation)!;
    expect(loser.whatWouldChange).toMatch(/withdrawn/);
    expect(loser.whatWouldChange).not.toMatch(/moving .* to the waitlist/);
  });
  it("on hold for a typo: simulates the figure the notes give", () => {
    const d = run([strong("APP-1", { investmentLakh: 300, notes: "Investment of about 30 lakh from my savings" })]).decisionById["APP-1"];
    expect(d.status).toBe("HOLD");
    expect(d.whatWouldChange).toMatch(/investment is confirmed as ₹30 lakh, APP-1 would score \d+ and be (conditionally )?approved/);
  });
  it("on hold for a city/pin clash: simulates the pin being right", () => {
    const d = run([strong("APP-1", { city: "Mysuru", pin: "560095" })]).decisionById["APP-1"];
    expect(d.whatWouldChange).toMatch(/pin 560095 is confirmed/);
    expect(d.whatWouldChange).toMatch(/Bengaluru/);
    expect(d.whatWouldChange).toMatch(/If the city is right instead/);
  });
  it("on hold for missing details: lists what is needed instead of guessing a result", () => {
    const d = run([strong("APP-1", { name: null, experienceYears: null })]).decisionById["APP-1"];
    expect(d.whatWouldChange).toMatch(/Needs answers first/);
    expect(d.whatWouldChange).toMatch(/applicant name/);
  });
  it("rejected on investment: shows the 60% line and the full-need outcome, and any knock-on", () => {
    const d = run([strong("APP-1", { investmentLakh: 15 })]).decisionById["APP-1"];
    expect(d.status).toBe("REJECTED");
    expect(d.whatWouldChange).toMatch(/At ₹21 lakh \(60% of the ₹35 lakh need, ₹6 lakh more, for example from a co-investor\)/);
    expect(d.whatWouldChange).toMatch(/at the full ₹35 lakh/);
  });
  it("does not change anything it simulates: the base decisions are untouched", () => {
    const apps = [strong("APP-1", { investmentLakh: 10 }), strong("APP-2", { pin: "560017" })];
    const withSim = run(apps);
    const without = run(apps, [ter()], {}, false);
    const brief = (r: typeof withSim) => r.decisions.map((d) => [d.id, d.status, d.score, d.allocation?.pin]);
    expect(brief(withSim)).toEqual(brief(without));
  });
});

describe("onboarding in the decision record", () => {
  const apps = [
    strong("APP-1", { name: "A One" }),
    strong("APP-2", { name: "B Two", pin: "560017", floor: "Upper" }),
    strong("APP-3", { name: "C Three", pin: "560095" }),
    strong("APP-4", { name: "D Four", investmentLakh: 300 }),
    strong("APP-5", { name: "E Five", investmentLakh: 10 }),
    strong("APP-6", { name: "F Six", pin: "560048", investmentLakh: 38 }),
  ];
  const r = run(apps, [ter({ openSlots: 3 })]);
  it("approved, conditional and redirected applicants get next steps and a full readiness plan", () => {
    const moving = r.decisions.filter((d) => ["APPROVED", "CONDITIONAL", "REDIRECT"].includes(d.status));
    expect(moving.length).toBeGreaterThanOrEqual(3);
    for (const d of moving) {
      expect(d.nextSteps!.length).toBeGreaterThanOrEqual(3);
      expect(d.nextSteps!.length).toBeLessThanOrEqual(6);
      expect(d.readinessPlan?.indicative).toBe(false);
      expect(d.readinessPlan!.timeline.find((b) => b.key === "opening")!.start).toBe(d.plannedOpenDate);
      expect(d.readinessPlan!.training.modules.length).toBeGreaterThanOrEqual(5);
    }
  });
  it("a redirect gets a site-at-the-new-pin condition and a shortlist step", () => {
    const red = r.decisions.find((d) => d.status === "REDIRECT")!;
    expect(red.flags.find((f) => f.code === "SITE_AT_NEW_PIN")?.severity).toBe("condition");
    expect(red.conditions?.some((c) => c.code === "SITE_AT_NEW_PIN")).toBe(true);
    expect(red.nextSteps!.some((s) => /Shortlist sites/.test(s.text))).toBe(true);
  });
  it("waitlisted applicants get an indicative training plan only; held and rejected get none", () => {
    const wait = run([strong("APP-1"), strong("APP-2", { name: "B Two", pin: "560095", investmentLakh: 38 })], [ter({ pins: ["560095"] })]).decisions.find((d) => d.status === "WAITLIST")!;
    expect(wait.readinessPlan).toMatchObject({ indicative: true, timeline: [] });
    expect(wait.readinessPlan!.training.modules.length).toBeGreaterThan(0);
    expect(wait.nextSteps).toBeUndefined();
    for (const id of ["APP-4", "APP-5"]) {
      expect(r.decisionById[id].readinessPlan).toBeUndefined();
      expect(r.decisionById[id].nextSteps).toBeUndefined();
    }
  });
  it("planned open date and timeline all fall after today", () => {
    for (const d of r.decisions.filter((x) => x.readinessPlan && !x.readinessPlan.indicative)) {
      expect(d.plannedOpenDate! > TODAY).toBe(true);
      for (const b of d.readinessPlan!.timeline) expect(b.start >= TODAY).toBe(true);
    }
  });
  it("explanations of approved applicants name the score, payback and planned opening", () => {
    const d = r.decisions.find((x) => x.status === "APPROVED")!;
    expect(d.why).toContain(`${d.score}/100`);
    expect(d.why).toMatch(/payback is about \d+ months/);
    expect(d.why).toMatch(/Planned opening is around/);
  });
  it("conditional explanations list each condition with its deadline", () => {
    const d = run([strong("APP-1", { floor: "Upper" })]).decisionById["APP-1"];
    expect(d.status).toBe("CONDITIONAL");
    expect(d.why).toMatch(/To close before opening:.*\(by \d+ \w+ \d{4}\)/);
  });
});
