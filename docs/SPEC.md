# BUILD SPEC — Franchise Expansion Engine (Ops Hackathon, Case 1)

> Full functional spec. `CLAUDE.md` is the short always-loaded brief; this file is the detail. Locked choices are in `docs/DECISIONS.md` and win over anything here if they conflict.
> Product name on screen: **Franchise Expansion Engine**.

---

## 0. What we are building and how it is judged

A web app that takes the brand's Excel file (Applications + Territories + fixed Existing stores) and, for **every** applicant, decides what should happen, explains why in plain language, and — for those moving forward — gives next steps and a store-readiness/training plan. A chat panel answers "why" questions and accepts new information that changes decisions.

Judges will:
1. Upload their own Excel (same template). Some rows will be incomplete or contradictory; several applicants will compete for the same territory/pin.
2. Ask in plain language: "Why is APP-007 on hold?"
3. Give new info: "APP-012 has now found a ground-floor space" — and check the decision (and knock-on effects) change sensibly.
4. Use it with **no login, no help**. A rate limit / paywall / crash = test failed.

Judged on **reasoning and clarity of explanation**, not technical depth. So:
- Every decision must be **deterministic, consistent, and traceable to named rules**.
- AI is used for reading messy text, writing explanations, and the chat — **never** as the decision-maker.
- The app must **never** break the hard rule: no two stores in the same pin code.

### Design principle (say this in the UI and the deck)
"Rules decide, AI explains." A deterministic engine applies hard rules and a transparent 100-point score. The AI reads free-text fields (bounded to ±5 points, with the quoted source text shown) and turns plain-language questions/updates into engine actions.

---

## 1. Stack & deployment

- **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui**, deployed on **Vercel** (free tier).
- **SheetJS (`xlsx`)** for parsing in the browser.
- **Engine runs in the browser** (pure TypeScript module `/lib/engine`), so uploads are instant and cost nothing. The same module is importable server-side for the chat route.
- **Leaflet + react-leaflet** with OpenStreetMap tiles for the map (load client-side only, `dynamic(..., { ssr:false })`).
- **Google Gen AI SDK (`@google/genai`)** in server routes only. Key in Vercel env `GEMINI_API_KEY`. Never expose it to the client (no `NEXT_PUBLIC_` prefix).
  - Chat, explanations, applicant messages: `process.env.GEMINI_CHAT_MODEL` (default `gemini-3.8-flash`)
  - Bulk note extraction at upload: `process.env.GEMINI_FAST_MODEL` (default `gemini-3.5-flash-lite`)
  - Model IDs live in env vars so they can be swapped without code changes. Verify both IDs in Google AI Studio before deploying.
  - Use Gemini **function calling** for chat tools and **structured output (`responseMimeType: "application/json"` + `responseSchema`)** for extraction. Validate everything with zod anyway.
  - `temperature: 0`. 20s timeout + 1 retry. **Every AI call has a deterministic fallback** (see §8.5).
- **zod** for validating all AI JSON output.
- **vitest** for tests.
- State lives in the browser (React state + `localStorage` wrapped in try/catch). No database, no auth.
- Deploy a hello-world to Vercel in the first 30 minutes to catch deploy problems early.
- Set a budget alert / quota cap for the Gemini key in Google Cloud. Add per-IP throttling on API routes (30 req/min per visitor; in-memory map is acceptable for the hackathon) so a looping client can't burn the budget. When throttled, the route returns a friendly message and the client uses rules-only mode for that request.

---

## 2. Input parsing (must be bulletproof)

### 2.1 Workbook
- Find sheets by **case-insensitive fuzzy name**: contains "application", contains "territor", contains "existing". Ignore any other sheets (our stress file has an extra "Test key (ours)" sheet — it must be ignored).
- If the Existing stores sheet is missing or empty, use the built-in fixed list (§3.2) and show an info notice.
- **Header row detection:** scan the first 10 rows for the row containing "Application ID" (resp. "Territory ID", "Store ID"). Data starts on the next row.
- **Column mapping by header text**, not position (normalise: lowercase, strip `₹`, brackets, punctuation, extra spaces). Map:
  - Applications: application id, applicant name, city, state, pin code, investment capacity, retail experience, current / past business, space available, space size, floor, target launch, preferred language, notes.
  - Territories: territory id, city, state, pin codes covered, city tier, open slots, priority.
- Also support the combined "City · State · Pin code" single-column form from the brief (split on `·`, `|`, `,`) in case a judge file uses it.
- **Skip fully blank rows; do not stop at the first blank** (the template has validation down to row 500).
- **Template example row:** row 3 in the template is a grey example (`APP-001, Ravi Kumar, Mysuru, 570001, 25, 4, Runs a footwear store, Rented, 450, Ground, 3, Kannada, Wants to open before Diwali` and `TER-01, Mysuru, 570001, 570002, 570008, Tier 2, 3, High`). If a row matches the example **exactly on every field**, exclude it by default and show a banner: "Ignored the template's example row (APP-001 Ravi Kumar). [Include it]". The toggle re-runs the engine. Also exclude it automatically if another row has the same ID.

### 2.2 Value normalisation
- Pin: SheetJS gives `570001` or `570001.0` or `"570001"` → string of digits. Valid = exactly 6 digits.
- Numbers: accept `"25"`, `"25 lakh"`, `"₹25L"`, `"25,00,000"` (convert rupees >1000 to lakh by /100000 and flag "converted from rupees"). Unparseable → null + flag.
- Fixed lists: trim + case-insensitive match (`ground` → `Ground`, `mall` → `Mall unit`, `not yet` → `Not yet identified`). Unknown value → null + flag.
- Pin codes covered: split on comma/space/semicolon/newline; keep valid 6-digit strings; flag invalid tokens.
- Keep the **raw row** alongside the normalised one so explanations can quote what the applicant wrote.

---

## 3. Reference data

### 3.1 Allowed values (hard-coded constants)
| City | Prefix | Tier |
|---|---|---|
| Bengaluru | 560 | Tier 1 |
| Mysuru | 570 | Tier 2 |
| Mangaluru | 575 | Tier 2 |
| Hubballi-Dharwad | 580 | Tier 2 |
| Belagavi | 590 | Tier 2 |
| Tumakuru | 572 | Tier 3 |
| Davanagere | 577 | Tier 3 |

Languages: Kannada, English, Hindi.

**Tier source of truth = this table.** If a territory row states a different tier (our stress file sets Davanagere to Tier 2), use the table's tier and flag: "TER-10 says Tier 2, but Davanagere is Tier 3 per the brand's city list — using Tier 3."

### 3.2 Existing stores (fixed fallback)
ST-01 Bengaluru 560001 (2019), ST-02 Bengaluru 560034 (2020), ST-03 Bengaluru 560038 (2021), ST-04 Bengaluru 560066 (2022), ST-05 Bengaluru 560076 (2023), ST-06 Mysuru 570009 (2021), ST-07 Mysuru 570017 (2024), ST-08 Mangaluru 575001 (2022), ST-09 Hubballi-Dharwad 580020 (2023), ST-10 Belagavi 590001 (2024).

### 3.3 Pin geodata — `/data/karnataka_pins.json`
Built from the India Post pincode directory + a pincode-centroid dataset. 438 pins across the 7 prefixes. Shape:
```json
{ "pins": { "560038": { "city":"Bengaluru","area":"Indiranagar","district":"Bengaluru Urban",
                        "lat":12.97835,"lng":77.64079,"kmFromCityCentre":3.2, ... } },
  "cityCentroids": { "Bengaluru": {"lat":..,"lng":..,"refPin":"560001"}, ... } }
```
- Use `area` to make explanations human ("560038 (Indiranagar)"). `area` may be null → show just the pin.
- Pin not in the file → use the city centroid, mark coordinates "approximate", lower confidence, and say so in the explanation.
- `kmFromCityCentre > 25` → info flag "pin is outside the city proper (~X km from centre)" (577/572 prefixes cover whole districts).
- Coordinates are pin-code centroids, not exact shop addresses. State this as an assumption in the UI and the deck.

---

## 4. Brand assumptions (editable in an "Assumptions" drawer; changing any value re-runs the engine)

Brand framing (locked): the tool works for **"the brand"** — a generic fast-growing retail brand. Its store format is **benchmarked on a Lenskart-style specialty retail store** (small-format, 300–800 sq ft, ground floor or mall, high-street visibility). Say this exactly once, in the Assumptions drawer and the empty state. Do not call the brand Lenskart, do not use Lenskart's logo or name in the UI, and keep training modules category-neutral ("product & category training", not "eye tests"). Defaults:

| Key | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| Store set-up investment needed (₹ lakh) | 35 | 28 | 22 |
| Expected monthly revenue, mature store (₹ lakh) | 7.0 | 5.0 | 3.5 |
| Catchment radius (km) | 2 | 3 | 5 |

| Key | Default |
|---|---|
| Partner's monthly operating profit as % of revenue | 20% |
| Upper-floor revenue penalty | −35% |
| Revenue lost per % catchment overlap | 50% of overlap % |
| Minimum space (sq ft) / ideal range | 300 / 400–800 |
| Oversized space flag above (sq ft) | 1,500 |
| Cannibalisation bands (overlap % of catchment) | Low < 10, Moderate 10–25, Elevated 25–45, **Blocked ≥ 45** |
| Max acceptable payback (months) | 36 (flag), 48 (blocks approval → conditional) |
| Approve threshold / minimum score to hold a slot | 70 / 55 |
| Redirect penalty if applicant would lose an existing site | −8 |
| Condition deadlines | 30 days (site/floor/finance), 14 days (data confirmations) |

Show an "Assumptions" badge on every screen linking to this drawer. These map 1:1 to deck slide 4.

---

## 5. Engine pipeline

`runEngine(input, assumptions, overrides) → EngineResult`. Pure, deterministic, same input → same output. Steps:

### 5.1 Validate each application → flags
Each flag: `{code, severity: 'blocker'|'condition'|'warning'|'info', field, message, question?}`. `question` is what we'd ask the applicant.

**Blockers (→ HOLD):**
- `MISSING_REQUIRED`: name, city, pin, investment, experience, or space available blank. List every missing field.
- `INVALID_PIN`: not 6 digits.
- `CITY_NOT_ALLOWED`.
- `CITY_PIN_MISMATCH`: pin prefix ≠ city's prefix (APP-007: Mysuru + 560034). Say which city the pin actually belongs to (and its area) and use AI signals from notes if they support one side ("notes mention Devaraja Market, which is in Mysuru").
- `INVESTMENT_OUTLIER`: investment > 150 lakh or > 4× tier need (APP-030: 300). Ask to confirm; if notes give another figure, quote it.
- `INVESTMENT_CONTRADICTION`: AI found a different amount in the notes (APP-030 notes say ~30).
- `PROBABLE_DUPLICATE`: same normalised name + same pin as an earlier row (APP-024 ≈ APP-023). Hold the later row; flag the differing fields on both.
- `DUPLICATE_ID`: two rows share an Application ID → hold both, ask which is correct.

**Conditions (allowed to proceed, but must be closed before opening):**
- `FIN_GAP` (85–100% of need), `FIN_GAP_LARGE` (60–85%).
- `FIND_SPACE` (Not yet identified).
- `NEED_GROUND_FLOOR` (Upper).
- `SPACE_TOO_SMALL` (< 300 sq ft).
- `CONFIRM_SIZE` (Owned/Rented but size blank).
- `CONFIRM_FLOOR` (space but floor blank / Not known).
- `SPACE_CONTRADICTION` (Not yet identified but size/floor filled — APP-031; treat as not identified, ask).
- `LOAN_DEPENDENT` (AI signal: funding depends on a loan — APP-033) → condition "loan sanction letter".
- `PAYBACK_LONG` (payback > 48 months).

**Warnings / info:**
- `STATE_MISMATCH` (state ≠ Karnataka — APP-031 "Kerala"), `UNREALISTIC_TARGET` (target < realistic, incl. 0 months), `DEADLINE_UNREACHABLE` (e.g. "before Diwali" when Diwali 2026 = 8 Nov 2026 is inside the minimum timeline — keep a small festival-date table, verify dates), `OVERSIZED_SPACE`, `OUTSIDE_CITY_CORE`, `NO_TERRITORY` (pin in no territory), `PIN_IN_MULTIPLE_TERRITORIES` (570002 in TER-05 and TER-11 → use the higher-priority territory, tie → lower ID, and say so), `TIER_MISMATCH`, `SAME_APPLICANT_MULTIPLE` (same name, different pins: APP-003 & APP-035 → at most one allocation per person), `APPROX_COORDS`, `ZERO_EXPERIENCE`.

Territory-level validation: empty pins, slots < 0 or non-numeric, duplicate territory IDs, tier mismatch, pins that already contain an existing store (info: "560038 in TER-01 already has ST-03 — not available"), pins outside the city's prefix.

### 5.2 Enrich
- Territory lookup by pin (§5.1 rule for multi-territory pins).
- Geo: coordinates, area name, km to every existing store, nearest existing store.
- Catchment overlap with each existing store: two circles of radius r (by tier) at distance d. Overlap % = lens area / (πr²):
  `A = 2r²·acos(d/2r) − (d/2)·√(4r² − d²)` for d < 2r, else 0. Use the applicant's tier radius.
- AI note signals (§8.1) merged in.

### 5.3 Hard rules (constraints)
- **H1** No new store in a pin that has an existing store.
- **H2** At most one new store per pin.
- **H3** New stores per territory ≤ open slots.
- **H4** A new store must sit in a territory with open slots.
- **H5** No new store with catchment overlap ≥ 45% with an existing store **or another newly allocated store**.
- **H6** At most one store per applicant (same normalised name).

After every run, an **invariant checker** re-verifies H1–H6 on the final allocation. If anything fails, throw in dev and show an error banner in prod (it should never happen). When it passes, show a badge: "✓ All 6 placement rules verified" with a tooltip listing them. Judges will love this.

### 5.4 Score (0–100), transparent breakdown
| Component | Max | Rule |
|---|---|---|
| **Financial readiness** | 25 | ratio = investment / tier need. ≥1.25 → 25; 1.10–1.25 → 22; 1.00–1.10 → 19; 0.85–1.00 → 12 (+FIN_GAP); 0.60–0.85 → 5 (+FIN_GAP_LARGE); <0.60 → **REJECT** |
| **Operator experience** | 20 | years: 0→3, 1→7, 2→9, 3–4→12, 5–7→14, 8+→15; **plus relevance 0–5** from business text: eyewear/optical/watches 5; specialty retail (apparel, footwear, jewellery, mobile, electronics, gifts, books, pharmacy, stationery) 4; general/food retail, F&B, retail manager (salaried) 3; non-retail business owner 2; salaried non-retail / blank 0; +1 (cap 5) if prior franchise experience |
| **Site readiness** | 20 | Owned + Ground/Mall + 300–1500 sq ft → 20; Rented same → 18; size blank → −4 (+CONFIRM_SIZE); floor unknown → 12 (+CONFIRM_FLOOR); Upper → 6 (+NEED_GROUND_FLOOR); < 300 sq ft → 6 (+SPACE_TOO_SMALL); > 1500 → −2 (OVERSIZED); Not yet identified → 6 (+FIND_SPACE) |
| **Location fit** | 20 | Territory priority High 10 / Medium 7 / Low 4 + cannibalisation safety vs **existing** stores: <10% → 10; 10–25% → 7; 25–45% → 3; ≥45% → pin blocked |
| **Launch readiness** | 10 | realistic months R (§5.6) vs target T: T ≥ R → 10; T ≥ R−1 → 7; T < R−1 → 4 (+UNREALISTIC_TARGET); T > 12 → 6 ("low urgency"); T blank → 8 |
| **AI-read signals** | ±5 | sum of note signals, capped at ±5, each shown with the quoted text |

Score components are computed once per applicant. New-vs-new overlap is checked during allocation (H5), not in the score.
If the applicant's own pin is blocked (existing store at the pin, or ≥ 45% overlap with an existing store), cannibalisation safety = 0 and the reason says the pin is blocked; they can still win a slot via redirect (§5.5).
If no territory contains the pin, location = 0 + priority of the territory they are eventually redirected to (computed in pass 2).

### 5.5 Allocation (who gets which slot)
1. **Candidates** = not HOLD, not REJECTED, score ≥ 55. Others: score < 55 → WAITLIST ("not ready yet", with the improvement path).
2. For each candidate determine whether its **own pin is viable**: pin in a territory, no existing store there, overlap with existing < 45%.
3. **Effective score** = score − 8 if the applicant needs a different pin **and** has a site (Owned/Rented) they'd lose. No penalty if they have no site yet (APP-025 is flexible and loses nothing). Sort order uses the penalty when the pin is already known to be blocked vs existing stores; if a pin becomes blocked during allocation (a higher scorer took it, or new-vs-new overlap), apply the penalty in the explanation and immediately try the alternatives below.
4. **Pass 1 (own territory)** — sort by effective score desc; tie-break: financial score, earlier realistic launch, Application ID. For each:
   - skip if this person already holds an allocation (H6) → flag
   - own pin viable, territory has a slot, pin free, new-vs-new overlap < 45% → **allocate own pin**
   - else, if own territory has a free slot → pick the **best alternative pin in the same territory** (free, no existing store, overlap < 45% vs all existing + allocated; minimise max overlap, then distance from applicant's pin) → **allocate as REDIRECT**
   - else → displaced
5. **Pass 2 (same city)** — displaced candidates and NO_TERRITORY applicants, in effective-score order, try other territories **in the same city** with free slots (best pin by distance from applicant's pin, then overlap) → REDIRECT (cross-territory). Else → WAITLIST.
6. **Waitlists** per territory, ranked by score: "Next in line if a conditional approval lapses".
7. **Unfilled-slot insights** per territory: slots left and why — no applicants, applicants not ready, or no viable pins left because of cannibalisation (list the remaining viable pins, or say "none: every listed pin is within X% of an existing/new store"). This is an expansion-team insight; make it prominent.

### 5.6 Realistic timeline (months from today)
Base 2.5 (agreement 2 wks + fit-out 6 wks + training in parallel). Add: Mall unit +0.5; Not yet identified +1.5; Upper/too small (must move) +1.5; any finance condition +1; zero experience or non-retail background +0.5; redirect +1.5. Planned open date = today + max(T, R) months. Use the real current date.

### 5.7 Payback estimate (per allocated or candidate applicant)
monthly revenue = tier revenue × (Upper? 0.65) × (size < 300? 0.8) × (1 − 0.5 × max overlap%).
monthly partner profit = revenue × 20%.
payback months = tier investment / monthly profit. Show the formula and the inputs in a tooltip. > 36 → warning; > 48 → condition PAYBACK_LONG. (Defaults give ~25 / 28 / 31 months for clean T1/T2/T3 stores.)

### 5.8 Final status
| Status | When |
|---|---|
| **APPROVED** | allocated own pin, score ≥ 70, no open conditions |
| **CONDITIONAL** | allocated own pin, but has conditions or 55 ≤ score < 70 |
| **REDIRECT** | allocated, but at a different pin/territory than applied for (slot reserved 30 days while they secure a site there) |
| **WAITLIST** | eligible but lost the slot/pin, or score < 55 ("not ready yet") |
| **HOLD** | can't decide: missing / contradictory / duplicate data. Lists exact questions |
| **REJECTED** | fails a hard minimum (investment < 60% of tier need). Always says what would change it |

---

## 6. Decision record (one per applicant)

```ts
type Decision = {
  id: string; status: Status; headline: string;          // one line, e.g. "Approved for 560095 (Koramangala), TER-01"
  score: number | null; breakdown: ScoreComponent[];     // each {name, points, max, reason}
  reasons: Reason[];      // ordered, each {code, text, impact: 'decisive'|'major'|'minor'}
  flags: Flag[];          // data issues + conditions
  allocation?: { territoryId; pin; area; redirectedFrom?; slotReservedUntil? };
  competitors?: { id; score; outcome; whyTheyWon: string }[];   // "APP-002 (84) beat you for 560095: +7 site, +5 experience"
  cannibalisation: { storeId; km; overlapPct; band }[];
  payback?: { months; inputs };
  waitlistRank?: { territoryId; rank; of };
  conditions?: { text; deadline; owner }[];
  nextSteps?: Step[];     // §7
  readinessPlan?: Plan;   // §7
  questionsForApplicant?: string[];  // for HOLD
  whatWouldChange?: string;          // for REJECTED/WAITLIST
  confidence: 'high'|'medium'|'low'; // low when coords approximate, AI signals decisive, or data contradictory
};
```

**Explanations are generated deterministically from reason codes** (template strings), so they exist even if AI is down. AI only polishes them on demand ("Explain in simple words" button, and in chat). Every explanation must:
- lead with the decision in one sentence;
- name the deciding rule(s) and the numbers;
- for competitive losses, name who won and the point difference by component;
- end with what happens next / what would change the decision.

Example (deterministic template): "Waitlisted for TER-07. APP-013 holds the only slot in Hubballi-Dharwad. You scored 66 vs 68: you have no shop space yet (site 6/20) while APP-013 has a rented space. If you secure a ground-floor space of 300+ sq ft, your score rises to ~74 and you would take the slot."

The "what would change it" line comes from re-running the engine in simulation with the obvious fix (§8.3 `what_if`). Precompute it for HOLD/WAITLIST/REJECTED.

---

## 7. Onboarding: next steps + store-readiness plan
For APPROVED / CONDITIONAL / REDIRECT. Generated deterministically; dates relative to today.

**Next steps (first 2 weeks)** — 3–6 items, each with owner (Partner / Brand) and due date: sign LOI + token fee; submit KYC & proof of funds (PAN, Aadhaar, GST, 6-month bank statement, property papers or rent agreement); close each condition by its deadline; site audit visit (date); for REDIRECT: shortlist sites in suggested pins (list pins + area names).

**Timeline to opening** (Gantt-style bars): conditions window → agreement → licences (Shop & Establishment, GST, trade licence; parallel) → fit-out (6 wks; mall +2) → hiring (2–3 staff, starts 5 wks before opening) → partner training → staff training (2 wks before) → soft launch → opening → 30/60/90-day reviews.

**Partner training plan — in the preferred language** (trainer and material in Kannada/Hindi/English):
- Core: Brand & product (3 days), POS/inventory/ordering (2 days), Selling & customer service (2 days), Store ops, cash & compliance (1 day).
- **Retail fundamentals bootcamp (+5 days)** if experience 0–1 years or non-retail background.
- **Fast-track** (skip fundamentals, shorter shadowing) if 8+ years or directly relevant category.
- **On-the-job shadowing at the nearest existing store** — name it, area, distance ("1 week at ST-06 Saraswathipuram, 4.3 km away"; 2 weeks if new to retail; if the nearest store is far, e.g. Davanagere → ST-09 Hubballi, say so and offer a 1-week residential stint).
- **Buddy partner**: owner of the nearest existing store.
- Staff training: 5 days, 2 weeks before opening, at the store, in the partner's language.

**Applicant message draft** (button): a short status message to the applicant in their preferred language — approval with next steps, or the exact questions for HOLD, or a respectful rejection with what would change it. AI-generated (chat model); English template fallback. Show the English version alongside Kannada/Hindi for the reviewer.

---

## 8. AI layer

### 8.1 Note extraction at upload (fast model, one batched call, cached by content hash)
Input per applicant: business text, notes, and the structured fields (so it can spot contradictions), plus today's date and the festival table. Output (zod-validated) per applicant:
```json
{ "id":"APP-030",
  "businessCategory":"specialty_retail", "relevance":4, "priorFranchise":false, "retailManagerSalaried":false,
  "signals":[ {"type":"contradiction","field":"investment","text":"Notes say ~30 lakh but the column says 300","quote":"Investment of about 30 lakh from my savings","value":30,"impact":0},
              {"type":"red","text":"Funding depends on a bank loan","quote":"...","impact":-2},
              {"type":"green","text":"Has run a franchise before","quote":"...","impact":2},
              {"type":"deadline","text":"Wants to open before Diwali (8 Nov 2026)","quote":"...","date":"2026-11-08","impact":0},
              {"type":"site","text":"Ground floor likely available in January","quote":"...","impact":1} ] }
```
Rules for the prompt: impact −3..+3 each; never invent facts; quote exact text; "unsure" → no signal. **Deterministic fallback**: keyword rules for category/relevance (optical, eyewear, spectacle, watch, footwear, apparel, boutique, saree, mobile, electronics, pharmacy, gift, stationery, book, kirana, grocery, bakery, cafe, restaurant, franchise, manager, IT, software, job…), and regexes for "loan", "lakh" amounts, "Diwali", "withdraw", "partner", "basement", "first floor". Show a small "AI-read" chip next to every signal used, with the quote on hover.

### 8.2 Chat panel ("Ask the engine")
Server route `/api/chat` with Gemini function calling (loop: model → function calls → run engine tools → return results → model, max 5 rounds). The model gets a compact system prompt + tools; **it answers only from tool results**. Engine state is sent from the client with each request (it's small) and the route runs the engine server-side for tool calls, returning updated state + diff to the client.

Tools:
- `get_overview()` — counts, slots per territory, unfilled-slot insights, data-quality alerts.
- `get_application(id)` — full Decision + raw row.
- `compare(idA, idB)` — component-by-component diff.
- `get_territory(id)` — slots, allocations, waitlist, viable pins left.
- `list(status?, territory?, city?)`.
- `what_if(changes[])` — simulate without committing; returns the diff.
- `apply_update(changes[], sourceText)` — commit, re-run, return the **diff of every applicant whose status/allocation changed**.
- `withdraw(id, reason)`, `set_assumption(key, value)`, `update_territory(id, changes)`, `undo()`, `reset_to_upload()`.

`changes[]` schema: `{ target: 'application'|'territory', id, field: <enumerated field>, value, note? }`. Enumerated application fields: investment, experienceYears, business, spaceAvailable (`Owned`|`Rented`|`Not yet identified`|`Identified (ownership unconfirmed)`), spaceSize, floor, targetLaunch, language, pin, city, notes, plus `addSignal` for facts that aren't a field ("bank sanctioned the loan" → clears LOAN_DEPENDENT; "has a trained optometrist" → green signal).

### 8.3 Update behaviour (critical for the APP-012 test)
- Apply only what the user stated. Never invent a value. "APP-012 found a ground-floor space" → `floor=Ground`, `spaceAvailable=Identified (ownership unconfirmed)` (scored like Rented), size stays blank → CONFIRM_SIZE condition. The reply says what was assumed and what is still needed.
- After every update, reply in this structure:
  1. **What I changed** (fields, old → new)
  2. **New decision for APP-012** + why (score old → new, by component)
  3. **Knock-on effects**: every other applicant whose status/allocation changed and why ("APP-013 moves from Conditional to Waitlist #1 for TER-07: APP-012 now outscores them 73 vs 66").
  4. **Still needed** (open conditions).
- Every committed change goes into a **Change log** tab (timestamp, source text, field diffs, status diffs) with **Undo**. The detail drawer shows the applicant's history ("Was: Waitlist → Now: Conditional, after: 'found a ground-floor space'").
- Ambiguous references ("the Mysuru guy") → ask a one-line clarifying question with the candidate IDs.
- Unknown ID → say it doesn't exist and list the closest IDs.

### 8.4 Chat answer style (system prompt essentials)
Plain language for an expansion manager. Lead with the answer. Cite numbers and rules by name. Max ~120 words unless asked for detail. Never contradict the engine; if the user disagrees with a decision, explain the rule, offer the `what_if`, and suggest changing an assumption if they want different behaviour. Suggested-question chips under the input: "Why is APP-007 on hold?", "Who's competing for TER-01?", "Which slots are unfilled and why?", "APP-012 has now found a ground-floor space".

### 8.5 Fallback when AI is unavailable
A deterministic intent parser handles the common patterns so the judge test still passes if the API fails or rate-limits:
- `/why.*(APP-\d+)/i` → deterministic explanation.
- `/(APP-\d+).*(found|got|secured|has).*(ground|upper|first|mall)/i` → floor update (+ size/rent parsing if present).
- `/(APP-\d+).*(invest|lakh)\D*(\d+)/i` → investment update.
- `/(APP-\d+).*(withdr|dropp|backed out|not interested)/i` → withdraw.
- `/compare (APP-\d+).*(APP-\d+)/i`, `/(TER-\d+)/` → territory summary.
- Else: "AI is temporarily unavailable — I can answer 'why is APP-xxx …', compare two applicants, or apply updates like 'APP-012 found a ground-floor space'."
Show a subtle "Rules-only mode" badge when in fallback.

---

## 9. UI

Clean, professional ops-tool look (not a landing page). Consistent status colours: Approved green, Conditional teal, Redirect blue, Waitlist amber, Hold purple, Rejected red. Works at 1280px+ and is usable on a phone.

- **Top bar**: product name · "Load sample data" (loads `/public/sample/Stress_Test_Case1.xlsx`) · "Upload Excel" · "Download template" (`/public/Case1_Franchise_Test_Data_Format.xlsx`) · "Assumptions" · "Export results (.xlsx)" · "Start over" (clears saved state after a confirm) · rules-verified badge.
- **Persistence**: parsed input, assumptions, change log and chat history are saved to `localStorage` (wrapped in try/catch; app works if storage is blocked). On reload, restore and re-run the engine.
- **Empty state**: drag-and-drop upload, "Try with sample data" (loads our stress file), 3-line explanation of what the tool does.
- **Overview tab**: KPI tiles by status; slots filled per territory (bar); **Data-quality alerts** (template row ignored, tier mismatch, multi-territory pins, duplicates, zero-slot territories); **Needs your attention** (HOLDs with their questions, conditions due soon); **Unfilled-slot insights**.
- **Applications tab**: sortable/filterable table — ID, name, city · pin (area), territory, status chip, score (mini bar), payback, headline reason. Row click → **detail drawer**:
  - decision headline + plain-language "Why" (deterministic; "Explain simply" → AI);
  - score breakdown bars with reasons; AI-read signals with quotes;
  - competitors and "why they won";
  - cannibalisation table + mini map;
  - conditions with deadlines; questions for applicant (HOLD); what would change it;
  - next steps, timeline (Gantt), training plan; applicant message draft (language toggle);
  - edit fields inline (same path as chat updates) + change history.
- **Territories tab**: one card per territory — slots (filled/total), allocated stores, waitlist queue, viable pins remaining, flags.
- **Map tab**: existing stores (dark pins), new allocations (green/teal/blue), waitlist/hold (grey); catchment circles (toggle); dashed arrow from a redirected applicant's original pin to the assigned pin; city filter; click → drawer.
- **Change log tab**: all updates with diffs and Undo.
- **Chat panel**: right side, collapsible, persistent across tabs, with suggested-question chips. Clicking an APP-ID in any chat answer opens its drawer.
- **Export**: decisions sheet (one row per applicant: status, allocation, score, components, reasons, conditions, next steps, planned open date) + territories sheet.

---

## 10. Testing (do this properly — the MVP is 35%)

1. **Unit tests (vitest)**: parser (example row, blank rows, float pins, header variants, combined City·State·Pin column, extra sheets), geo (haversine, overlap formula: d=0 → 100%, d ≥ 2r → 0), each validation flag, each score band, allocation tie-breaks, H1–H6.
2. **Invariant fuzzing**: generate 300 random workbooks (random pins incl. existing-store pins, duplicates, blanks, 0 slots, overlapping territories); assert H1–H6 hold and every applicant gets exactly one status with a non-empty explanation. Engine never throws.
3. **Stress file** `/test-data/Stress_Test_Case1.xlsx`: 34 trap applications + 12 territories in the exact judge template, with a "Test key (ours)" sheet describing what each row tests and the sensible outcome. Write a test that loads it and asserts the key behaviours: APP-007 HOLD (city/pin mismatch); APP-030 HOLD (investment); APP-024 HOLD (duplicate); APP-029 HOLD (missing list); APP-014 REJECTED; nothing allocated at 560038/560076/560034/560001; TER-10 treated as Tier 3; APP-003 and APP-035 not both allocated; TER-12 gets nothing; only one of APP-008/APP-009 at their own pins; APP-026 not allocated.
4. **Judge simulation script** (run against the deployed URL before submitting):
   - Why is APP-007 on hold? · Why is APP-009 not approved? · Why did APP-002 beat APP-003? · What does APP-008 need to do next? · How will APP-006 be trained? · Which territories have unfilled slots and why? · Is anything planned in a pin that already has a store? · What's APP-017's payback?
   - APP-012 has now found a ground-floor space → expect APP-012 up, APP-013 bumped.
   - APP-030's investment is actually 30 lakh → hold clears, re-ranked.
   - APP-010 has moved to a ground-floor unit of 400 sq ft → competes with APP-011.
   - APP-002 has withdrawn → APP-003 (or next) moves into 560095 / TER-01.
   - TER-03 now has 2 open slots → re-allocation.
   - APP-033's bank loan was sanctioned → condition clears.
   - Change the Tier 2 catchment radius to 2 km → Mysuru cluster re-evaluated.
   - Ask about APP-999 → graceful "doesn't exist".
5. **Deployed checks**: incognito window, phone, a second laptop; upload the original blank template (0 applicants → friendly empty state, no crash); upload a non-Excel file → friendly error.

---

## 11. Build order (overnight)

| # | Block | Done when |
|---|---|---|
| P0 | Scaffold Next.js + Tailwind + shadcn, deploy hello-world to Vercel, env var set | Public URL works in incognito |
| P1 | Parser + reference data + validation flags | Stress file parses; JSON dump of flags looks right |
| P2 | Geo, scoring, allocation, invariant checker + unit tests | All stress-file assertions pass |
| P3 | Timeline, payback, onboarding plan, deterministic explanations, what-would-change | Every applicant has a full decision record |
| P4 | UI: upload, overview, table, drawer, territories, assumptions, export | Usable end-to-end without AI |
| P5 | AI: note extraction, chat with tools, update + diff + change log, message drafts, fallback parser | Judge simulation script passes |
| P6 | Map | Redirect arrows + catchments visible |
| P7 | Hardening: fuzzing, deployed checks, polish copy | Zero crashes, invariants hold on 300 random files |

Commit after every block. Never leave the deployed link broken: deploy from `main`, build on branches.

---

## 12. Non-negotiables
- No login anywhere. No API key in the client.
- No two stores in one pin, ever. Invariant badge visible.
- Every applicant gets a status, a one-line headline, a plain-language why, and (if moving forward) next steps + training plan.
- Every AI-derived input is visible, quoted, and bounded.
- If AI fails, the app still works (rules-only mode).
- All assumptions are visible and editable.
