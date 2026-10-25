import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS, runEngine } from "../../lib/engine";
import { applyChange, coerceValue, diffResults, outcomeOf, withdrawApplication, type Change } from "../../lib/engine/changes";
import { draftMessage, englishMessage } from "../../lib/engine/message";
import type { Overrides } from "../../lib/engine/types";
import { TODAY, mkApp, mkInput, mkTer } from "../helpers/fixtures";

const ter = mkTer({ id: "TER-A", pins: ["560095", "560017", "560048"], openSlots: 1 });
const apps = [mkApp({ id: "APP-1", name: "A One", pin: "560017" }), mkApp({ id: "APP-2", name: "B Two", pin: "560095", spaceAvailable: "Not yet identified", spaceSize: null, floor: "Not known" })];
const input = mkInput(apps, [ter]);
const run = (o: Overrides = {}) => runEngine(input, DEFAULT_ASSUMPTIONS, o, { today: TODAY, simulate: false });

describe("coerceValue (what someone types into an edit box)", () => {
  it("reads numbers, blanks and units", () => {
    expect(coerceValue("investmentLakh", "₹40L")).toEqual({ ok: true, value: 40 });
    expect(coerceValue("investmentLakh", "25,00,000")).toEqual({ ok: true, value: 25 });
    expect(coerceValue("spaceSize", "")).toEqual({ ok: true, value: null });
    expect(coerceValue("experienceYears", "lots")).toMatchObject({ ok: false });
  });
  it("matches fixed lists and says what is allowed when it can't", () => {
    expect(coerceValue("floor", "ground floor")).toEqual({ ok: true, value: "Ground" });
    expect(coerceValue("spaceAvailable", "rented")).toEqual({ ok: true, value: "Rented" });
    expect(coerceValue("language", "hindi")).toEqual({ ok: true, value: "Hindi" });
    expect(coerceValue("floor", "rooftop")).toMatchObject({ ok: false, message: expect.stringContaining("Ground") });
  });
  it("tidies city and pin", () => {
    expect(coerceValue("city", "bangalore")).toEqual({ ok: true, value: "Bengaluru" });
    expect(coerceValue("pin", "560 095")).toEqual({ ok: true, value: "560095" });
    expect(coerceValue("pin", "")).toEqual({ ok: true, value: null });
  });
});

describe("applyChange", () => {
  it("records the old and new value and leaves the original overrides alone", () => {
    const base: Overrides = {};
    const change: Change = { target: "application", id: "APP-2", field: "floor", value: "Ground" };
    const r = applyChange(input, base, change)!;
    expect(r.diff).toMatchObject({ id: "APP-2", field: "floor", from: "Not known", to: "Ground" });
    expect(r.overrides.applications?.["APP-2"]).toEqual({ floor: "Ground" });
    expect(base).toEqual({});
  });
  it("does nothing when the value is unchanged, or the target doesn't exist", () => {
    expect(applyChange(input, {}, { target: "application", id: "APP-2", field: "floor", value: "Not known" })).toBeNull();
    expect(applyChange(input, {}, { target: "application", id: "APP-99", field: "floor", value: "Ground" })).toBeNull();
    expect(applyChange(input, {}, { target: "territory", id: "TER-99", field: "openSlots", value: 2 })).toBeNull();
  });
  it("compares against the current value, edits included", () => {
    const first = applyChange(input, {}, { target: "application", id: "APP-2", field: "floor", value: "Ground" })!;
    expect(applyChange(input, first.overrides, { target: "application", id: "APP-2", field: "floor", value: "Ground" })).toBeNull();
    expect(applyChange(input, first.overrides, { target: "application", id: "APP-2", field: "floor", value: "Upper" })!.diff.from).toBe("Ground");
  });
  it("handles territory edits, added facts and closed conditions", () => {
    expect(applyChange(input, {}, { target: "territory", id: "TER-A", field: "openSlots", value: 2 })!.overrides.territories).toEqual({ "TER-A": { openSlots: 2 } });
    const sig = { type: "green" as const, impact: 2, text: "Has a trained optometrist", quote: "has a trained optometrist" };
    expect(applyChange(input, {}, { target: "application", id: "APP-1", field: "addSignal", value: sig })!.overrides.addedSignals?.["APP-1"]).toEqual([sig]);
    const closed = applyChange(input, {}, { target: "application", id: "APP-1", field: "resolve", value: "FIN_GAP" })!;
    expect(closed.overrides.resolved?.["APP-1"]).toEqual(["FIN_GAP"]);
    expect(applyChange(input, closed.overrides, { target: "application", id: "APP-1", field: "resolve", value: "FIN_GAP" })).toBeNull();
  });
  it("withdrawing is recorded once", () => {
    const w = withdrawApplication(input, {}, "APP-1", "found another franchise")!;
    expect(w.overrides.withdrawn).toEqual({ "APP-1": "found another franchise" });
    expect(w.diff.to).toContain("withdrawn");
    expect(withdrawApplication(input, w.overrides, "APP-1", "again")).toBeNull();
    expect(withdrawApplication(input, {}, "APP-99", "")).toBeNull();
  });
});

describe("diffResults (what moved)", () => {
  it("lists everyone whose status or placement changed, with before and after", () => {
    const before = run();
    expect(before.decisionById["APP-2"].status).toBe("WAITLIST");
    const after = run({ withdrawn: { "APP-1": "gone" } });
    const diff = diffResults(before, after);
    const ids = diff.map((d) => d.id).sort();
    expect(ids).toEqual(["APP-1", "APP-2"]);
    const two = diff.find((d) => d.id === "APP-2")!;
    expect(two.from.status).toBe("WAITLIST");
    expect(["APPROVED", "CONDITIONAL"]).toContain(two.to.status);
    expect(two.to.where).toContain("TER-A");
  });
  it("leaves out applicants whose outcome is the same, unless asked to include a score change", () => {
    const before = run();
    const after = run({ applications: { "APP-1": { experienceYears: 8 } } });
    expect(diffResults(before, after)).toEqual([]);
    const withSelf = diffResults(before, after, ["APP-1"]);
    expect(withSelf.map((d) => d.id)).toEqual(["APP-1"]);
    expect(withSelf[0].to.score).toBeGreaterThan(withSelf[0].from.score as number);
  });
  it("describes where someone ended up", () => {
    const r = run();
    expect(outcomeOf(r.decisionById["APP-1"]).where).toMatch(/^560017 .*TER-A$/);
    expect(outcomeOf(r.decisionById["APP-2"]).where).toBe("waitlist #1 for TER-A");
  });
});

describe("message draft", () => {
  const r = runEngine(input, DEFAULT_ASSUMPTIONS, {}, { today: TODAY, simulate: true });
  it("approved: congratulates, names the pin, lists dated next steps and the training", () => {
    const m = englishMessage(r.decisionById["APP-1"]);
    expect(m).toMatch(/^Dear A,/);
    expect(m).toMatch(/Congratulations/);
    expect(m).toMatch(/560017/);
    expect(m).toMatch(/next steps:/);
    expect(m).toMatch(/pay the token fee \(by \d+ \w+ \d{4}\)/);
    expect(m).toMatch(/training is \d+ days in English/);
    expect(m.trim().endsWith("Expansion Team")).toBe(true);
  });
  it("waitlist: says where they stand and what would help", () => {
    const m = englishMessage(r.decisionById["APP-2"]);
    expect(m).toMatch(/waitlist/);
    expect(m).toMatch(/#1 for TER-A/);
  });
  it("hold: asks the exact questions", () => {
    const held = runEngine(mkInput([mkApp({ id: "APP-3", name: "C Three", investmentLakh: 300 })], [ter]), DEFAULT_ASSUMPTIONS, {}, { today: TODAY });
    const m = englishMessage(held.decisionById["APP-3"]);
    expect(m).toMatch(/we need a few details/);
    expect(m).toMatch(/- Please confirm your investment capacity/);
  });
  it("rejected: kind, with what would change it", () => {
    const rej = runEngine(mkInput([mkApp({ id: "APP-3", name: "C Three", investmentLakh: 15 })], [ter]), DEFAULT_ASSUMPTIONS, {}, { today: TODAY, simulate: true });
    const m = englishMessage(rej.decisionById["APP-3"]);
    expect(m).toMatch(/below the minimum/);
    expect(m).toMatch(/At ₹21 lakh/);
  });
  it("is under about 140 words for approved applicants, and falls back to English with a note for other languages", () => {
    expect(englishMessage(r.decisionById["APP-1"]).split(/\s+/).length).toBeLessThan(160);
    const hi = draftMessage(r.decisionById["APP-1"], "Hindi");
    expect(hi).toMatchObject({ translated: false, language: "Hindi" });
    expect(hi.note).toMatch(/Translation unavailable/);
    expect(hi.message).toBe(hi.englishVersion);
    expect(draftMessage(r.decisionById["APP-1"], "English")).toMatchObject({ translated: true, note: undefined });
  });
});
