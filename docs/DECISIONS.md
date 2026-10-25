# Locked decisions (agreed with Anshull, 25 Oct 2026)

Change any of these only after asking Anshull. Each line: decision, then why.

## Product
| # | Decision | Why |
|---|---|---|
| D1 | Product name on screen: **Franchise Expansion Engine** | Plain, says what it does |
| D2 | Brand framing: generic **"the brand"**, store format benchmarked on a **Lenskart-style specialty store** (300–800 sq ft, ground floor or mall). Mentioned only in the Assumptions drawer and empty state; no Lenskart name/logo elsewhere | Case says "a retail brand"; data is store-shaped; Lenskart is the reference company |
| D3 | Philosophy: **rules decide, AI explains**. Deterministic engine; AI bounded to ±5 points with quoted text | Consistent, auditable answers to judges' "why" questions |

## Decisions logic
| # | Decision | Why |
|---|---|---|
| D4 | Six statuses: **Approved, Conditional, Redirect, Waitlist, Hold, Rejected** | Each maps to a distinct next action for the expansion team |
| D5 | Hard placement rules H1–H6 (SPEC §5.3), incl. real distance-based cannibalisation using `data/karnataka_pins.json` | Brief's hard rule + real geo-selection |
| D6 | Redirects: a blocked applicant is offered a safer pin **in their own territory first, then another territory in the same city**. −8 effective-score penalty only if they'd lose a site they already have | Don't lose strong partners to a bad pin |
| D7 | Free slots are **not** force-filled with applicants scoring < 55; tool reports unfilled slots and why | Better insight than a weak approval |
| D8 | All scoring numbers and assumptions = **SPEC defaults** (investment ₹35/28/22 L by tier, catchment 2/3/5 km, min 300 sq ft, block at ≥45% overlap, approve ≥70, slot ≥55, payback model). Editable on screen | Speed tonight; tune after testing; becomes deck slide 4 |
| D9 | Tier always comes from the Allowed-values city table, not the territory row (flag mismatches) | Template defines tier per city |

## Tech
| # | Decision | Why |
|---|---|---|
| D10 | **Next.js + TypeScript on Vercel**, engine runs in the browser, AI in server routes | One codebase; key stays server-side |
| D11 | **Gemini** (Anshull's paid key): chat/explanations/messages `gemini-3.8-flash`; note extraction `gemini-3.5-flash-lite`. Model IDs in env vars | Anshull's account; Flash for quality, Flash-Lite for cheap batch reads |
| D12 | Deploy: **GitHub → Vercel auto-deploy** | Every push ships; easy rollback |
| D13 | Protection: **per-visitor throttle (~30 AI calls/min) + rules-only fallback** | Judges must never hit a rate-limit failure |
| D14 | Persistence: **localStorage** (input, assumptions, change log, chat) with a **Start over** button | Judges can refresh without losing work |

## Features in scope
| # | Feature |
|---|---|
| F1 | Upload + robust parsing of the judge template (incl. ignoring the template's example row, blank rows, extra sheets) |
| F2 | Overview, Applications table + detail drawer, Territories, Change log |
| F3 | **Map with catchments** (Leaflet + OSM): existing stores, new allocations, catchment circles, redirect arrows |
| F4 | Chat panel: why-questions, comparisons, updates with knock-on diff, undo |
| F5 | **Applicant message drafts** in Kannada / Hindi / English (with English shown alongside) |
| F6 | **Export to Excel** (decisions + territories) |
| F7 | **Editable assumptions** drawer; changes re-run the engine live |
| F8 | "Load sample data" loads `public/sample/Stress_Test_Case1.xlsx` (the 34-trap stress file) |
| F9 | Invariant badge "✓ All 6 placement rules verified" |

## UI
| # | Decision |
|---|---|
| U1 | Visual design comes from **Anshull's UI prompt** in `docs/UI_PROMPT.md`. The functional checklist in that file must still be met |
