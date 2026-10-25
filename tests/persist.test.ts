import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS } from "../lib/engine/assumptions";
import { STORAGE_KEY, clearPersisted, isPersisted, loadPersisted, savePersisted, type Persisted } from "../lib/state/persist";
import { mkInput } from "./helpers/fixtures";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

const baseInput = mkInput([]);
const sample = (): Persisted => ({
  v: 1,
  fileName: "x.xlsx",
  baseInput,
  notices: [],
  includeExamples: { application: false, territory: false },
  assumptions: DEFAULT_ASSUMPTIONS,
  overrides: { applications: { "APP-1": { floor: "Ground" } } },
  log: [],
  chat: [],
  chatOpen: true,
});

describe("saved state", () => {
  it("round-trips what was saved", () => {
    const s = new MemoryStorage();
    expect(savePersisted(sample(), s)).toBe(true);
    expect(loadPersisted(s)).toEqual(sample());
  });
  it("starts empty when nothing is saved, or the saved text is corrupt or from another shape", () => {
    const s = new MemoryStorage();
    expect(loadPersisted(s)).toBeNull();
    s.setItem(STORAGE_KEY, "{not json");
    expect(loadPersisted(s)).toBeNull();
    s.setItem(STORAGE_KEY, JSON.stringify({ v: 2, anything: true }));
    expect(loadPersisted(s)).toBeNull();
    s.setItem(STORAGE_KEY, JSON.stringify({ ...sample(), baseInput: { applications: "nope" } }));
    expect(loadPersisted(s)).toBeNull();
    expect(isPersisted(null)).toBe(false);
  });
  it("copes with storage that throws (blocked, full, private window)", () => {
    const boom = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(loadPersisted(boom)).toBeNull();
    expect(savePersisted(sample(), boom)).toBe(false);
    expect(() => clearPersisted(boom)).not.toThrow();
  });
  it("works when there is no storage at all (server)", () => {
    expect(loadPersisted(undefined)).toBeNull();
    expect(savePersisted(sample(), undefined)).toBe(false);
  });
  it("Start over removes the saved state", () => {
    const s = new MemoryStorage();
    savePersisted(sample(), s);
    clearPersisted(s);
    expect(loadPersisted(s)).toBeNull();
  });
});
