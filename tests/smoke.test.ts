import { describe, expect, it } from "vitest";
import pins from "@/data/karnataka_pins.json";

describe("project data", () => {
  it("ships the Karnataka pin table", () => {
    expect(Object.keys(pins.pins)).toHaveLength(438);
  });
});
