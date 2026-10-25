import type { Tier } from "./types";

/** Editable brand assumptions (SPEC §4, locked by D8). Changing any value re-runs the engine. */
export interface Assumptions {
  investmentNeedLakh: Record<Tier, number>;
  monthlyRevenueLakh: Record<Tier, number>;
  catchmentKm: Record<Tier, number>;
  partnerProfitPct: number;
  upperFloorRevenuePenaltyPct: number;
  /** Revenue lost per 1% of catchment overlap, as a fraction (0.5 = 50% of the overlap %). */
  overlapRevenueLossFactor: number;
  minSpaceSqft: number;
  idealSpaceMinSqft: number;
  idealSpaceMaxSqft: number;
  oversizedSpaceSqft: number;
  /** Overlap % bands: Low < lowBelow, Moderate < moderateBelow, Elevated < blockAt, Blocked >= blockAt. */
  overlapLowBelowPct: number;
  overlapModerateBelowPct: number;
  overlapBlockAtPct: number;
  paybackFlagMonths: number;
  paybackConditionMonths: number;
  approveScore: number;
  slotMinScore: number;
  redirectPenalty: number;
  conditionDays: { site: number; finance: number; data: number };
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  investmentNeedLakh: { 1: 35, 2: 28, 3: 22 },
  monthlyRevenueLakh: { 1: 7.0, 2: 5.0, 3: 3.5 },
  catchmentKm: { 1: 2, 2: 3, 3: 5 },
  partnerProfitPct: 20,
  upperFloorRevenuePenaltyPct: 35,
  overlapRevenueLossFactor: 0.5,
  minSpaceSqft: 300,
  idealSpaceMinSqft: 400,
  idealSpaceMaxSqft: 800,
  oversizedSpaceSqft: 1500,
  overlapLowBelowPct: 10,
  overlapModerateBelowPct: 25,
  overlapBlockAtPct: 45,
  paybackFlagMonths: 36,
  paybackConditionMonths: 48,
  approveScore: 70,
  slotMinScore: 55,
  redirectPenalty: 8,
  conditionDays: { site: 30, finance: 30, data: 14 },
};
