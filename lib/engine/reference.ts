import pinData from "../../data/karnataka_pins.json";
import type { ExistingStore, Floor, Language, Priority, SpaceAvailable, Tier } from "./types";

// ---- City table (SPEC §3.1). The tier source of truth (D9). ----

export interface CityInfo {
  city: string;
  prefix: string;
  tier: Tier;
  /** Other spellings people use. Compared after lowercasing and removing spaces/punctuation. */
  aliases: string[];
}

export const CITY_TABLE: CityInfo[] = [
  { city: "Bengaluru", prefix: "560", tier: 1, aliases: ["bangalore", "bengalore", "bangaluru", "blr"] },
  { city: "Mysuru", prefix: "570", tier: 2, aliases: ["mysore"] },
  { city: "Mangaluru", prefix: "575", tier: 2, aliases: ["mangalore"] },
  {
    city: "Hubballi-Dharwad",
    prefix: "580",
    tier: 2,
    aliases: ["hubli-dharwad", "hubli", "hubballi", "dharwad", "hubbali"],
  },
  { city: "Belagavi", prefix: "590", tier: 2, aliases: ["belgaum"] },
  { city: "Tumakuru", prefix: "572", tier: 3, aliases: ["tumkur"] },
  { city: "Davanagere", prefix: "577", tier: 3, aliases: ["davangere", "davanagiri"] },
];

export const CITY_NAMES = CITY_TABLE.map((c) => c.city);
export const STATE = "Karnataka";

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

const CITY_LOOKUP: Map<string, CityInfo> = new Map();
for (const c of CITY_TABLE) {
  CITY_LOOKUP.set(squash(c.city), c);
  for (const a of c.aliases) CITY_LOOKUP.set(squash(a), c);
}

/** Find a city from free text, tolerating case, spacing and common alternate spellings. */
export function findCity(text: string | null | undefined): CityInfo | null {
  if (!text) return null;
  return CITY_LOOKUP.get(squash(text)) ?? null;
}

export function tierOfCity(city: string | null | undefined): Tier | null {
  return findCity(city)?.tier ?? null;
}

export function cityOfPin(pin: string | null | undefined): CityInfo | null {
  if (!pin || !/^\d{6}$/.test(pin)) return null;
  return CITY_TABLE.find((c) => c.prefix === pin.slice(0, 3)) ?? null;
}

// ---- Fixed lists ----

export const LANGUAGES: Language[] = ["Kannada", "English", "Hindi"];
export const FLOORS: Floor[] = ["Ground", "Upper", "Mall unit", "Not known"];
export const SPACE_OPTIONS: SpaceAvailable[] = ["Owned", "Rented", "Not yet identified"];
export const PRIORITIES: Priority[] = ["High", "Medium", "Low"];
export const PRIORITY_RANK: Record<Priority, number> = { High: 3, Medium: 2, Low: 1 };

// ---- Existing stores: built-in fallback (SPEC §3.2) ----

export const DEFAULT_EXISTING_STORES: ExistingStore[] = [
  { id: "ST-01", city: "Bengaluru", pin: "560001", openedYear: 2019 },
  { id: "ST-02", city: "Bengaluru", pin: "560034", openedYear: 2020 },
  { id: "ST-03", city: "Bengaluru", pin: "560038", openedYear: 2021 },
  { id: "ST-04", city: "Bengaluru", pin: "560066", openedYear: 2022 },
  { id: "ST-05", city: "Bengaluru", pin: "560076", openedYear: 2023 },
  { id: "ST-06", city: "Mysuru", pin: "570009", openedYear: 2021 },
  { id: "ST-07", city: "Mysuru", pin: "570017", openedYear: 2024 },
  { id: "ST-08", city: "Mangaluru", pin: "575001", openedYear: 2022 },
  { id: "ST-09", city: "Hubballi-Dharwad", pin: "580020", openedYear: 2023 },
  { id: "ST-10", city: "Belagavi", pin: "590001", openedYear: 2024 },
];

// ---- Pin geodata (SPEC §3.3) ----

export interface PinInfo {
  city: string;
  area: string | null;
  district: string | null;
  lat: number;
  lng: number;
  kmFromCityCentre: number | null;
}

interface PinFile {
  pins: Record<string, PinInfo>;
  cityCentroids: Record<string, { lat: number; lng: number; refPin: string }>;
}

const PIN_FILE = pinData as unknown as PinFile;

export function getPin(pin: string | null | undefined): PinInfo | null {
  if (!pin) return null;
  return PIN_FILE.pins[pin] ?? null;
}

export function cityCentroid(city: string | null | undefined) {
  const c = findCity(city);
  return c ? (PIN_FILE.cityCentroids[c.city] ?? null) : null;
}

/** "560038 (Indiranagar)" or just the pin when the area is unknown. */
export function pinLabel(pin: string): string {
  const area = getPin(pin)?.area;
  return area ? `${pin} (${area})` : pin;
}

export const OUTSIDE_CITY_CORE_KM = 25;

// ---- Validation thresholds (SPEC §5.1) ----

export const INVESTMENT_OUTLIER_MAX_LAKH = 150;
export const INVESTMENT_OUTLIER_MULTIPLE = 4;

// ---- Timeline constant used for the "deadline can't be met" check (SPEC §5.6 base) ----

export const BASE_TIMELINE_MONTHS = 2.5;

// ---- Festival dates (SPEC §8.1 / AI_PROMPTS). Verify before deploy. ----

export const FESTIVALS: { name: string; date: string }[] = [
  { name: "Diwali", date: "2026-11-08" },
  { name: "Pongal", date: "2027-01-14" },
  { name: "Ugadi", date: "2027-04-07" }, // verify
  { name: "Dussehra", date: "2027-10-19" }, // verify
  { name: "Diwali", date: "2027-10-29" },
];

// ---- Dates (IST) ----

export function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

export function addMonthsISO(iso: string, months: number): string {
  return addDaysISO(iso, months * 30.4375);
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// ---- Template example rows (SPEC §2.1): compared field by field after normalisation ----

export const EXAMPLE_APPLICATION = {
  id: "APP-001",
  name: "Ravi Kumar",
  signature: [
    "app-001", "ravi kumar", "mysuru", "karnataka", "570001", "25", "4", "runs a footwear store",
    "rented", "450", "ground", "3", "kannada", "wants to open before diwali",
  ],
};

export const EXAMPLE_TERRITORY = {
  id: "TER-01",
  signature: ["ter-01", "mysuru", "karnataka", "570001,570002,570008", "tier 2", "3", "high"],
};
