# AI prompts and schemas (Gemini)

All calls: server routes only, `temperature: 0`, 20s timeout, 1 retry, zod-validate output, deterministic fallback on any failure. Extra guards in the code: a signal is dropped unless its quote appears verbatim in the applicant's own text; "Explain simply" and translated messages are discarded if they drop or change the numbers; `x-force-fallback: 1` forces rules-only mode in non-production builds; each visitor is limited to 30 AI calls a minute. Model from env (`GEMINI_CHAT_MODEL` / `GEMINI_FAST_MODEL`). Always pass today's date (IST) in the prompt.

---

## 1. Note extraction — `/api/extract` (fast model, structured output)

Called once per upload with all applicants in one batch (chunk at 40 per call). Cache by SHA-256 of the input so re-runs and refreshes don't re-call.

**System prompt**
```
You read franchise applications for a retail brand's expansion team. For each applicant you get their structured fields and two free-text fields ("Current / past business" and "Notes from applicant").

Your job is ONLY to extract facts from the free text. You do not make decisions.

Rules:
- Use only what is written. Never guess or add facts.
- Every signal must include "quote": the exact words from the applicant's text it is based on.
- "impact" is between -3 and +3 and reflects how the fact affects readiness to open and run a store. Use 0 for neutral facts and deadlines.
- If text is blank or says nothing useful, return no signals.
- Flag a "contradiction" when the text disagrees with a structured field (e.g. a different investment amount, says the space is on the first floor while Floor says Ground, mentions a city other than the stated city). Put the field name in "field" and the number or value from the text in "value".
- Use type "finance" when the applicant's funding depends on a bank loan or other outside finance (the engine turns it into the loan-sanction condition).
- Recognise deadlines and festivals. Today is {{TODAY}}. Festival dates: {{FESTIVALS_JSON}}. Return the date in ISO format.
- Classify the business into exactly one category from the schema enum. A salaried store manager in retail is "retail_manager".
- Set "priorFranchise" true only if the text says they have run or currently run a franchise.
```

**User content**: JSON array of `{id, city, pin, investmentLakh, experienceYears, spaceAvailable, spaceSize, floor, targetLaunchMonths, business, notes}`.

**Response schema** (also the zod schema):
```ts
{ results: Array<{
  id: string;
  businessCategory: "eyewear_optical_watches" | "specialty_retail" | "general_or_food_retail" | "retail_manager" | "non_retail_business" | "salaried_non_retail" | "unknown";
  priorFranchise: boolean;
  signals: Array<{
    type: "green" | "red" | "contradiction" | "deadline" | "site" | "finance" | "info";
    text: string;            // one plain sentence
    quote: string;           // exact words from the applicant
    impact: number;          // -3..3 integer
    field?: "investment" | "floor" | "spaceSize" | "spaceAvailable" | "city" | "pin" | "experience" | "targetLaunch";
    value?: string | number;
    date?: string;           // ISO date for deadlines
  }>;
}>}
```

**Fallback** (no AI): keyword rules for category (optical, eyewear, spectacle, watch → eyewear_optical_watches; footwear, apparel, boutique, saree, textile, jewellery, mobile, electronics, pharmacy, gift, stationery, book, perfume, sports → specialty_retail; kirana, grocery, bakery, cafe, restaurant, paan → general_or_food_retail; "store manager", "worked as manager" → retail_manager; IT, software, job, professional → salaried_non_retail), regexes for `franchise`, `(\d+)\s*(lakh|l\b)`, `loan`, `diwali|dussehra|ugadi|pongal`, `withdraw`, `first floor|upper floor|basement`.

**Festival table** (verify dates before deploy): Diwali 2026-11-08, Diwali 2027-10-29, Ugadi 2027-04-07 (verify), Dussehra 2027-10-19 (verify).

---

## 2. Chat — `/api/chat` (chat model, function calling)

Request body: `{ messages, engineInput, overrides, assumptions }` (engine state is small; send it each time). The route rebuilds the engine result server-side, runs the tool loop (max 5 rounds), and returns `{ reply, newOverrides?, diff?, usedFallback }`.

**System prompt**
```
You are the assistant inside "Franchise Expansion Engine", a tool used by a retail brand's expansion team to decide which franchise applicants move forward. Today is {{TODAY}}.

How you work:
- A rules engine makes every decision. You never decide or guess a status, score or allocation yourself. Always call a tool to get facts before answering, and answer only from tool results.
- When the user gives new information about an applicant or territory, convert it into apply_update with only the fields they actually stated. Never invent values. If something needed is missing (for example the size of a newly found space), do not guess it; the engine will turn it into a condition, and you say what is still needed.
- If someone says an applicant has found a space and gives a floor but not who owns it or how big it is, set only floor, and spaceAvailable to "Identified (ownership unconfirmed)". Leave the size alone.
- If the user only asks "what if", use what_if and make clear nothing was changed.
- If a reference is ambiguous (e.g. "the Mysuru applicant" when there are several), ask one short question listing the candidate IDs.
- If an ID doesn't exist, say so and suggest the closest IDs.
- If the user disagrees with a decision, explain the rule and numbers behind it, offer a what_if, and mention that thresholds can be changed in Assumptions. Never change a decision just because the user pushes back.

How you answer:
- Plain language for a busy expansion manager. Lead with the answer in one sentence.
- Name the rule and the numbers (scores, km, overlap %, ₹ lakh, months).
- Write IDs exactly (APP-012, TER-07) so the UI can link them.
- Keep it under ~120 words unless asked for detail. Use short bullets only for lists of applicants.
- After an update, always use this structure:
  **What I changed:** field: old → new
  **New decision for <ID>:** status, score old → new, why
  **Knock-on effects:** every other applicant whose status or allocation changed, and why (or "None")
  **Still needed:** open conditions (or "Nothing")
```

**Function declarations**
| Name | Parameters | Returns |
|---|---|---|
| `get_overview` | – | counts by status, territory slots, unfilled-slot insights, data alerts |
| `get_application` | `id` | full Decision record + raw row |
| `compare` | `idA`, `idB` | component-by-component score diff + who wins what and why |
| `get_territory` | `id` | slots, allocations, waitlist, viable pins, flags |
| `list_applications` | `status?`, `territoryId?`, `city?` | id, name, status, score, headline |
| `what_if` | `changes[]` | diff of statuses/allocations, nothing committed |
| `apply_update` | `changes[]`, `sourceText` | committed diff + new overrides |
| `withdraw` | `id`, `reason` | committed diff |
| `update_territory` | `id`, `changes` (`openSlots`, `priority`, `pins`) | committed diff |
| `set_assumption` | `key`, `value` | committed diff |
| `undo` | – | restored state diff |

`changes[]` item: `{ target: "application" | "territory", id: string, field: enum, value: string | number, note?: string }`. Application field enum: `investmentLakh, experienceYears, business, spaceAvailable, spaceSize, floor, targetLaunchMonths, language, pin, city, notes, addSignal`. `spaceAvailable` also accepts `"Identified (ownership unconfirmed)"`.

**Fallback** (Gemini down, throttled, or bad output): deterministic intent parser in SPEC §8.5; reply prefixed with nothing alarming, and the UI shows the "Rules-only mode" badge.

---

## 3. Explain simply — `/api/chat` with `mode: "explain"` (chat model)

```
Rewrite this decision explanation for the applicant's case so a non-expert expansion manager understands it in 3–4 sentences. Keep every number and rule exactly as given. Do not add reasons that are not in the input.
INPUT: {{DETERMINISTIC_EXPLANATION_AND_DECISION_JSON}}
```
Fallback: show the deterministic explanation unchanged.

---

## 4. Applicant message draft — `/api/message` (chat model)

Input: Decision record, applicant name, preferred language. Output JSON `{ language, message, englishVersion }`.

```
Write a short, warm, professional message from the brand's expansion team to a franchise applicant, in {{LANGUAGE}} (use the native script for Kannada and Hindi, simple everyday words). Also return the same message in English.

Content by status:
- Approved / Conditional / Redirect: congratulate, state the decision in one line, list the next steps with due dates, list any conditions with deadlines, mention their training plan briefly.
- Hold: thank them, explain we need a few details, list the exact questions.
- Waitlist: explain they are on the waitlist (with rank if given), why, and what would improve their chances.
- Rejected: thank them, give the main reason kindly, say what would change the decision.
Use only facts from the input. No promises beyond it. Under 140 words. Sign off as "Expansion Team".
INPUT: {{DECISION_JSON}}
```
Fallback: English template filled from the Decision record, with a note "Translation unavailable right now".
