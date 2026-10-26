import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS } from "../../lib/engine";
import { ToolRuntime, closestIds, looseId } from "../../lib/ai/tools";
import { TODAY, stressInput } from "../helpers/chat-harness";

const rt = () => new ToolRuntime({ input: stressInput(), assumptions: DEFAULT_ASSUMPTIONS, overrides: {}, readings: [], today: TODAY, undoTo: null });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = any;

describe("tool runtime: the model's calls are checked, never trusted", () => {
  it("matches IDs loosely", () => {
    const ids = ["APP-002", "APP-012", "APP-012#2"];
    expect(looseId("app 12", ids)).toBe("APP-012");
    expect(looseId("APP-12", ids)).toBe("APP-012");
    expect(looseId("app_002", ids)).toBe("APP-002");
    expect(looseId("APP-999", ids)).toBeUndefined();
    expect(looseId("nonsense", ids)).toBeUndefined();
    expect(closestIds("APP-01", ids, 2)).toHaveLength(2);
  });

  it("reads applicants and territories by loose ID", () => {
    const r = rt();
    expect((r.run("get_application", { id: "app 7" }) as R).id).toBe("APP-007");
    expect((r.run("get_territory", { id: "ter 7" }) as R).id).toBe("TER-07");
    expect((r.run("compare", { idA: "app 2", idB: "app 3" }) as R).higherScore).toBe("APP-002");
  });

  it("says plainly when something doesn't exist, with suggestions", () => {
    const r = rt();
    expect(r.run("get_application", { id: "APP-999" })).toMatchObject({ error: "There is no applicant APP-999.", didYouMean: expect.any(Array) });
    expect(r.run("get_territory", { id: "TER-99" })).toMatchObject({ error: expect.stringContaining("TER-99") });
    expect(r.run("compare", { idA: "APP-002", idB: "APP-999" })).toMatchObject({ error: expect.any(String) });
    expect(r.run("no_such_tool", {})).toEqual({ error: "Unknown tool no_such_tool." });
    expect(r.run("get_application", {})).toMatchObject({ error: expect.any(String) });
  });

  it("apply_update rejects bad values and unknown targets without changing anything", () => {
    const r = rt();
    const bad = r.run("apply_update", { changes: [{ target: "application", id: "APP-012", field: "floor", value: "Rooftop" }], sourceText: "x" }) as R;
    expect(bad.error).toMatch(/Choose Ground/);
    expect(r.run("apply_update", { changes: [{ target: "application", id: "APP-012", field: "colour", value: "red" }] })).toMatchObject({ error: expect.stringContaining("can't change") });
    expect(r.run("apply_update", { changes: [{ target: "territory", id: "TER-03", field: "openSlots", value: -1 }] })).toMatchObject({ error: expect.stringContaining("whole number") });
    expect(r.run("apply_update", { changes: [{ target: "territory", id: "TER-03", field: "priority", value: "Urgent" }] })).toMatchObject({ error: expect.stringContaining("High, Medium or Low") });
    expect(r.run("apply_update", { changes: "not an array" })).toMatchObject({ committed: false });
    expect(r.changed).toBe(false);
    expect(r.overrides).toEqual({});
  });

  it("an update that changes nothing says so and commits nothing", () => {
    const r = rt();
    const x = r.run("apply_update", { changes: [{ target: "application", id: "APP-012", field: "floor", value: "Not known" }], sourceText: "x" }) as R;
    expect(x.note).toMatch(/already how it is/);
    expect(r.changed).toBe(false);
  });

  it("what_if never commits; apply_update does, once", () => {
    const r = rt();
    const change = { target: "application", id: "APP-012", field: "floor", value: "Ground" };
    r.run("what_if", { changes: [change], sourceText: "if" });
    expect(r.changed).toBe(false);
    r.run("apply_update", { changes: [change], sourceText: "APP-012 is on the ground floor" });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].prev.overrides).toEqual({});
    expect(r.overrides.applications?.["APP-012"]).toEqual({ floor: "Ground" });
    expect(r.run("apply_update", { changes: [change], sourceText: "again" })).toMatchObject({ note: expect.stringMatching(/already/) });
    expect(r.entries).toHaveLength(1);
  });

  it("withdrawing works through the tool and through a change, and only once", () => {
    const r = rt();
    expect((r.run("withdraw", { id: "app 2", reason: "found another franchise" }) as R).applied[0].to).toContain("withdrawn: found another franchise");
    expect(r.run("withdraw", { id: "APP-002" })).toMatchObject({ committed: false });
    const r2 = rt();
    r2.run("what_if", { changes: [{ target: "application", id: "APP-002", field: "withdrawn", value: "" }] });
    expect(r2.changed).toBe(false);
    r2.run("apply_update", { changes: [{ target: "application", id: "APP-002", field: "withdrawn", value: "gone" }], sourceText: "APP-002 withdrew" });
    expect(r2.overrides.withdrawn).toEqual({ "APP-002": "gone" });
  });

  it("set_assumption checks the range, the ordering and unknown keys", () => {
    const r = rt();
    expect(r.run("set_assumption", { key: "catchmentKm.2", value: 0 })).toMatchObject({ error: expect.stringContaining("between") });
    expect(r.run("set_assumption", { key: "catchmentKm.2", value: 500 })).toMatchObject({ error: expect.stringContaining("between") });
    expect(r.run("set_assumption", { key: "nope", value: 3 })).toMatchObject({ error: expect.stringContaining("Unknown assumption") });
    expect(r.run("set_assumption", { key: "slotMinScore", value: 90 })).toMatchObject({ error: expect.stringContaining("approval score") });
    expect(r.run("set_assumption", { key: "catchmentKm.2", value: 3 })).toMatchObject({ note: expect.stringContaining("already") });
    expect(r.run("set_assumption", { key: "catchmentKm.2", value: "x" })).toMatchObject({ error: expect.any(String) });
    expect(r.changed).toBe(false);
    const ok = r.run("set_assumption", { key: "Catchment Km.2", value: 2 }) as R;
    expect(ok.committed).toBe(true);
    expect(r.assumptions.catchmentKm[2]).toBe(2);
    expect(ok.decisionsChanged).toBeGreaterThan(0);
  });

  it("undo has something to restore only after a change (or when the browser says there is one)", () => {
    expect(rt().run("undo", {})).toMatchObject({ error: expect.stringContaining("nothing to undo") });
    const r = rt();
    r.run("withdraw", { id: "APP-002" });
    expect(r.run("undo", {})).toMatchObject({ restored: true });
    expect(r.overrides).toEqual({});
    const withBrowserHistory = new ToolRuntime({ input: stressInput(), assumptions: DEFAULT_ASSUMPTIONS, overrides: { withdrawn: { "APP-002": "x" } }, readings: [], today: TODAY, undoTo: { overrides: {}, assumptions: DEFAULT_ASSUMPTIONS } });
    expect(withBrowserHistory.run("undo", {})).toMatchObject({ restored: true });
    expect(withBrowserHistory.overrides).toEqual({});
  });

  it("adding a fact: a sanctioned loan closes the condition; other facts become quoted signals", () => {
    const r = rt();
    const x = r.run("apply_update", { changes: [{ target: "application", id: "APP-033", field: "addSignal", value: "bank loan was sanctioned" }], sourceText: "APP-033's bank loan was sanctioned" }) as R;
    expect(x.assumptions.join(" ")).toMatch(/loan condition is treated as closed/);
    expect(r.overrides.resolved?.["APP-033"]).toEqual(["LOAN_DEPENDENT"]);
    const y = r.run("apply_update", { changes: [{ target: "application", id: "APP-002", field: "addSignal", value: "has a trained optometrist" }], sourceText: "APP-002 has a trained optometrist" }) as R;
    expect(y.applied[0].to).toContain("trained optometrist");
    expect(r.overrides.addedSignals?.["APP-002"]?.[0]).toMatchObject({ type: "green", impact: 1, quote: "APP-002 has a trained optometrist" });
  });

  it("reads: overview, list and territory carry what the model needs", () => {
    const r = rt();
    expect((r.run("get_overview", {}) as R).counts.HOLD).toBe(4);
    expect((r.run("list_applications", { status: "hold" }) as R).count).toBe(4);
    expect((r.run("list_applications", { territoryId: "ter-07" }) as R).applicants.length).toBeGreaterThan(1);
    expect((r.run("list_applications", { city: "mysuru" }) as R).count).toBeGreaterThan(3);
    const t = r.run("get_territory", { id: "TER-05" }) as R;
    expect(t.whyUnfilled.join(" ")).toMatch(/No viable pin/);
    expect(r.storeConflicts()).toEqual([]);
  });
});
