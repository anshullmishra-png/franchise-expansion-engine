import { findCity } from "./reference";
import type { Floor, Language, Priority, SpaceAvailable, Tier } from "./types";

// Value normalisation for messy spreadsheet cells (SPEC §2.2). Every function is total: it never throws.

/** Cell → trimmed display text. 570001.0 becomes "570001". */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, " ").trim();
}

export function isBlankCell(v: unknown): boolean {
  return cellText(v) === "";
}

/** Header text → lowercase words only. "Investment capacity (₹ lakh)" → "investment capacity lakh". */
export function normaliseHeader(v: unknown): string {
  return cellText(v)
    .toLowerCase()
    .replace(/₹/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Name used to spot duplicates and "same person" rows. */
export function normaliseName(v: string | null | undefined): string {
  return (v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Numbers ----

export interface NumberResult {
  value: number | null;
  /** The cell had text but no usable number (or a negative one). */
  invalid: boolean;
  /** Set when the value was converted (rupees or crore to lakh). */
  converted?: "rupees" | "crore";
}

/**
 * Accepts 25, "25", "25 lakh", "₹25L", "25,00,000", "1.2 cr", "5 years", "450 sq ft".
 * With lakh=true, a bare number above 1000 is read as rupees and divided by 100000.
 */
export function parseNumber(v: unknown, opts: { lakh?: boolean } = {}): NumberResult {
  if (v === null || v === undefined) return { value: null, invalid: false };
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return { value: null, invalid: true };
    return fromPlain(v, opts.lakh);
  }
  const text = cellText(v);
  if (text === "") return { value: null, invalid: false };
  const cleaned = text.toLowerCase().replace(/₹|rs\.?|inr/g, " ").replace(/,/g, "");
  const m = cleaned.match(/(\d+(?:\.\d+)?)\s*([a-z]*)/);
  if (!m || /^-\s*\d/.test(cleaned.trim())) return { value: null, invalid: true };
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return { value: null, invalid: true };
  if (opts.lakh) {
    const unit = m[2];
    if (/^(cr|crore|crores)$/.test(unit)) return { value: round(n * 100), invalid: false, converted: "crore" };
    if (/^(l|lakh|lakhs|lac|lacs)$/.test(unit)) return { value: n, invalid: false };
  }
  return fromPlain(n, opts.lakh);
}

function fromPlain(n: number, lakh?: boolean): NumberResult {
  if (lakh && n > 1000) return { value: round(n / 100000), invalid: false, converted: "rupees" };
  return { value: n, invalid: false };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

// ---- Pins ----

export function isValidPin(pin: string | null | undefined): boolean {
  return !!pin && /^\d{6}$/.test(pin);
}

/** One pin cell → digits as typed (may be invalid), or null when blank. */
export function parsePin(v: unknown): string | null {
  const text = cellText(v);
  if (text === "") return null;
  const compact = text.replace(/[\s-]/g, "").replace(/\.0+$/, "");
  return /^\d+$/.test(compact) ? compact : text;
}

/** "570001, 570002; 570008" → valid 6-digit pins and the tokens that were not valid pins. */
export function parsePinList(v: unknown): { pins: string[]; invalid: string[] } {
  const text = cellText(v);
  const pins: string[] = [];
  const invalid: string[] = [];
  if (text === "") return { pins, invalid };
  for (const token of text.split(/[,;\n/|]+|\s{2,}/)) {
    const t = token.trim().replace(/\.0+$/, "");
    if (t === "") continue;
    // Allow "570 001" inside one token; otherwise split on single spaces too.
    const compact = t.replace(/\s+/g, "");
    if (/^\d{6}$/.test(compact)) {
      if (!pins.includes(compact)) pins.push(compact);
      continue;
    }
    for (const part of t.split(/\s+/)) {
      if (/^\d{6}$/.test(part)) {
        if (!pins.includes(part)) pins.push(part);
      } else if (part) invalid.push(part);
    }
  }
  return { pins, invalid };
}

// ---- Fixed lists ----

export interface EnumResult<T> {
  value: T | null;
  /** The cell had text we could not match to an allowed value. */
  unknown: boolean;
}

const key = (v: unknown) => cellText(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function parseSpaceAvailable(v: unknown): EnumResult<SpaceAvailable> {
  const k = key(v);
  if (k === "") return { value: null, unknown: false };
  if (/^(owned|own|owner|self owned|self)$/.test(k)) return { value: "Owned", unknown: false };
  if (/^(rented|rent|leased|lease|on rent)$/.test(k)) return { value: "Rented", unknown: false };
  if (/^(not yet identified|not yet|not identified|none|no|no space|not found|yet to find|tbd|n a|na)$/.test(k))
    return { value: "Not yet identified", unknown: false };
  if (/^identified( ownership unconfirmed)?$/.test(k))
    return { value: "Identified (ownership unconfirmed)", unknown: false };
  return { value: null, unknown: true };
}

export function parseFloor(v: unknown): EnumResult<Floor> {
  const k = key(v);
  if (k === "") return { value: null, unknown: false };
  if (/^(ground|ground floor|gf|g f|street level|0)$/.test(k)) return { value: "Ground", unknown: false };
  if (/^(upper|upper floor|first|first floor|1st floor|second floor|2nd floor|1|2|mezzanine)$/.test(k))
    return { value: "Upper", unknown: false };
  if (/^(mall unit|mall|in mall|shopping mall)$/.test(k)) return { value: "Mall unit", unknown: false };
  if (/^(not known|unknown|not sure|na|n a|tbd)$/.test(k)) return { value: "Not known", unknown: false };
  return { value: null, unknown: true };
}

export function parseLanguage(v: unknown): EnumResult<Language> {
  const k = key(v);
  if (k === "") return { value: null, unknown: false };
  if (/^(kannada|kan|kn)$/.test(k)) return { value: "Kannada", unknown: false };
  if (/^(english|eng|en)$/.test(k)) return { value: "English", unknown: false };
  if (/^(hindi|hin|hi)$/.test(k)) return { value: "Hindi", unknown: false };
  return { value: null, unknown: true };
}

export function parsePriority(v: unknown): EnumResult<Priority> {
  const k = key(v);
  if (k === "") return { value: null, unknown: false };
  if (/^(high|h|hi)$/.test(k)) return { value: "High", unknown: false };
  if (/^(medium|med|m|mid|moderate)$/.test(k)) return { value: "Medium", unknown: false };
  if (/^(low|l|lo)$/.test(k)) return { value: "Low", unknown: false };
  return { value: null, unknown: true };
}

export function parseTier(v: unknown): EnumResult<Tier> {
  const k = key(v);
  if (k === "") return { value: null, unknown: false };
  const m = k.match(/^(?:tier |t )?([123])$/);
  if (m) return { value: Number(m[1]) as Tier, unknown: false };
  return { value: null, unknown: true };
}

/** Canonical city when recognised; otherwise the text as typed (so the blocker can quote it). */
export function parseCity(v: unknown): { city: string | null; known: boolean } {
  const text = cellText(v);
  if (text === "") return { city: null, known: false };
  const found = findCity(text);
  return found ? { city: found.city, known: true } : { city: text, known: false };
}

export function parseState(v: unknown): string | null {
  const text = cellText(v);
  if (text === "") return null;
  if (/^(ka|karnataka|karnatak)$/i.test(text)) return "Karnataka";
  return text;
}

/** Free text cell → trimmed text or null. */
export function parseText(v: unknown): string | null {
  const t = cellText(v);
  return t === "" ? null : t;
}
