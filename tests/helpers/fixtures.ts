import { DEFAULT_EXISTING_STORES } from "../../lib/engine/reference";
import type { Application, EngineInput, NoteReading, Territory } from "../../lib/engine/types";

let row = 3;

/** A clean, valid Tier 1 applicant at 560095 (TER-A). Override anything. */
export function mkApp(over: Partial<Application> = {}): Application {
  const id = over.id ?? `APP-${100 + row}`;
  return {
    id,
    sourceId: over.sourceId ?? id,
    rowNumber: row++,
    name: `Person ${id}`,
    city: "Bengaluru",
    state: "Karnataka",
    pin: "560095",
    investmentLakh: 45,
    experienceYears: 5,
    business: "Runs a footwear store",
    spaceAvailable: "Rented",
    spaceSize: 500,
    floor: "Ground",
    targetLaunchMonths: 4,
    language: "English",
    notes: null,
    raw: {},
    parseIssues: [],
    ...over,
  };
}

export function mkTer(over: Partial<Territory> = {}): Territory {
  const id = over.id ?? "TER-A";
  return {
    id,
    sourceId: over.sourceId ?? id,
    rowNumber: row++,
    city: "Bengaluru",
    state: "Karnataka",
    pins: ["560095", "560008"],
    invalidPinTokens: [],
    statedTier: 1,
    tier: 1,
    openSlots: 2,
    priority: "High",
    raw: {},
    parseIssues: [],
    ...over,
  };
}

export function mkInput(apps: Application[], territories: Territory[] = [mkTer()]): EngineInput {
  return {
    applications: apps,
    territories,
    existingStores: DEFAULT_EXISTING_STORES.map((s) => ({ ...s })),
    excludedExamples: { applications: [], territories: [] },
  };
}

export const TODAY = "2026-10-25";

export function reading(id: string, signals: NoteReading["signals"]): NoteReading {
  return { id, businessCategory: "specialty_retail", priorFranchise: false, signals };
}
