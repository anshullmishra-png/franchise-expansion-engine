import { FESTIVALS, findCity } from "../engine/reference";
import type { Application, BusinessCategory, NoteReading, NoteSignal } from "../engine/types";

// Deterministic stand-in for the Gemini note-extraction call (AI_PROMPTS §1 "Fallback").
// Used when AI is off, throttled or returns bad JSON, so the app keeps working in rules-only mode.
// Pure: no network, no clock (pass `today`).

const has = (text: string, words: string[]) => words.some((w) => new RegExp(`\\b${w}`, "i").test(text));

export function classifyBusiness(business: string | null | undefined): BusinessCategory {
  const t = (business ?? "").trim();
  if (!t) return "unknown";
  if (has(t, ["optical", "optician", "eyewear", "spectacle", "watch"])) return "eyewear_optical_watches";
  if (/store manager|worked as (a )?manager|retail manager/i.test(t)) return "retail_manager";
  if (
    has(t, [
      "footwear", "apparel", "boutique", "saree", "textile", "cloth", "jewel", "mobile", "electronic",
      "pharmacy", "gift", "stationery", "book", "perfume", "sport", "computer", "accessor",
    ])
  )
    return "specialty_retail";
  if (has(t, ["kirana", "grocery", "bakery", "cafe", "restaurant", "paan", "coffee", "hardware", "paint", "food"]))
    return "general_or_food_retail";
  if (has(t, ["it professional", "software", "job", "professional", "employee", "engineer", "salaried"]))
    return "salaried_non_retail";
  return "unknown";
}

/** The sentence of `text` containing the match, trimmed. Used as the exact quote. */
function sentenceAround(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf(".", index - 1), text.lastIndexOf(";", index - 1), text.lastIndexOf("\n", index - 1));
  const endCandidates = [".", ";", "\n"].map((c) => text.indexOf(c, index)).filter((i) => i >= 0);
  const end = endCandidates.length ? Math.min(...endCandidates) : text.length;
  return text.slice(start + 1, end).trim();
}

const LANDMARKS: [RegExp, string][] = [
  [/devaraja/i, "Mysuru"],
  [/jayanagar|koramangala|indiranagar|whitefield|mahadevapura|brigade road|electronics city|malleshwaram/i, "Bengaluru"],
  [/vidyanagar|hubli|dharwad/i, "Hubballi-Dharwad"],
  [/hampankatta|kadri|city centre mall/i, "Mangaluru"],
];

function nextFestival(name: string, today: string): string | null {
  const hit = FESTIVALS.filter((f) => f.name.toLowerCase() === name.toLowerCase() && f.date >= today).sort((a, b) =>
    a.date.localeCompare(b.date)
  )[0];
  return hit?.date ?? null;
}

type Reading = Pick<Application, "id" | "city" | "investmentLakh" | "floor" | "business" | "notes">;

export function extractNotesFallback(apps: Reading[], today: string): NoteReading[] {
  return apps.map((a) => readOne(a, today));
}

function readOne(a: Reading, today: string): NoteReading {
  const notes = a.notes ?? "";
  const business = a.business ?? "";
  const signals: NoteSignal[] = [];
  const push = (s: NoteSignal) => signals.push(s);

  // Investment stated in the notes that disagrees with the column.
  const money = /(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|l)\b/gi;
  for (let m = money.exec(notes); m; m = money.exec(notes)) {
    const sentence = sentenceAround(notes, m.index);
    const value = Number(m[1]);
    if (/invest|budget|capital|savings|capacity|can put|afford/i.test(sentence) && a.investmentLakh !== null && value !== a.investmentLakh) {
      push({
        type: "contradiction",
        field: "investment",
        value,
        impact: 0,
        quote: sentence,
        text: `Notes say about ${value} lakh but the Investment column says ${a.investmentLakh}.`,
      });
    }
  }

  const loan = /\bloan\b/i.exec(notes);
  if (loan) {
    push({
      type: "finance",
      impact: -2,
      quote: sentenceAround(notes, loan.index),
      text: "Funding depends on a bank loan.",
    });
  }
  const withdraw = /withdraw|back out|backed out|drop out/i.exec(notes);
  if (withdraw) {
    push({
      type: "red",
      impact: -1,
      quote: sentenceAround(notes, withdraw.index),
      text: "Applicant mentions they may withdraw.",
    });
  }

  for (const name of ["Diwali", "Dussehra", "Ugadi", "Pongal"]) {
    const m = new RegExp(name, "i").exec(notes);
    const date = m ? nextFestival(name, today) : null;
    if (m && date) {
      push({
        type: "deadline",
        impact: 0,
        date,
        quote: sentenceAround(notes, m.index),
        text: `Wants to open around ${name} (${date}).`,
      });
    }
  }

  const upper = /first floor|upper floor|basement|second floor/i.exec(notes);
  if (upper && a.floor === "Ground" && !/above our|in the same building/i.test(notes)) {
    push({
      type: "contradiction",
      field: "floor",
      value: "Upper",
      impact: 0,
      quote: sentenceAround(notes, upper.index),
      text: "Notes describe an upper floor but the Floor column says Ground.",
    });
  }
  const groundSoon = /ground[- ]floor[^.]*(vacant|available|likely)/i.exec(notes);
  if (groundSoon) {
    push({
      type: "site",
      impact: 1,
      quote: sentenceAround(notes, groundSoon.index),
      text: "A ground-floor space may become available soon.",
    });
  }

  if (/optometrist|optician/i.test(notes)) {
    const m = /optometrist|optician/i.exec(notes)!;
    push({ type: "green", impact: 1, quote: sentenceAround(notes, m.index), text: "Has trained optical staff ready." });
  }

  // Which city do the notes point to? (Supports one side of a city/pin mismatch.)
  for (const [re, city] of LANDMARKS) {
    const m = re.exec(notes);
    if (m) {
      push({
        type: "info",
        field: "city",
        value: city,
        impact: 0,
        quote: sentenceAround(notes, m.index),
        text: `Notes mention ${m[0]}, which is in ${city}.`,
      });
      break;
    }
  }
  const cityMention = notes.match(/\b(bengaluru|bangalore|mysuru|mysore|mangaluru|mangalore|hubballi|hubli|dharwad|belagavi|belgaum|tumakuru|tumkur|davanagere|davangere)\b/i);
  if (cityMention && !signals.some((s) => s.field === "city")) {
    const c = findCity(cityMention[0]);
    if (c) {
      push({
        type: "info",
        field: "city",
        value: c.city,
        impact: 0,
        quote: sentenceAround(notes, cityMention.index ?? 0),
        text: `Notes mention ${c.city}.`,
      });
    }
  }

  return {
    id: a.id,
    businessCategory: classifyBusiness(business),
    priorFranchise: /franchise/i.test(`${business} ${notes}`),
    signals,
  };
}
