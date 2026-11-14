# Franchise Expansion Engine

**Decides which franchise applicant gets which territory, and explains every decision in plain language.**

[![tests](https://github.com/anshullmishra-png/franchise-expansion-engine/actions/workflows/tests.yml/badge.svg)](https://github.com/anshullmishra-png/franchise-expansion-engine/actions/workflows/tests.yml) [![licence: MIT](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)

Live demo: coming soon · Built for a Mesa School of Business operations hackathon (Case 1). The brand and its applicants are fictional.

## The problem

A brand gets franchise applications for a limited set of territories. Some are incomplete or contradictory, several want the same pin code, and every applicant needs a clear decision with a reason, next steps and a plan.

## What I decided

- **Rules decide, AI explains.** A deterministic engine applies hard rules and a transparent 100-point score. Gemini only reads messy notes (worth at most ±5 points, with the quoted text shown), rephrases explanations and turns chat into calls to the engine.
- **It still works when the AI doesn't.** If Gemini is missing, slow or throttled, the app runs in rules-only mode.
- **Six placement rules are re-checked after every run,** such as never two stores on one pin code and no catchment overlap of 45% or more.

[Why it works this way: the decision log](docs/DECISIONS.md)

## Did it work?

The full test suite runs on every push. A stress suite adds a 34-trap file, 300-workbook rule fuzzing and messy-file checks.

## What it doesn't solve

Distances and catchments are estimates from pin-code centres, not street addresses, and the engine only knows what the applicant file contains.

## Try it

Locally, with no keys or login: `npm install`, `npm run dev`, open http://localhost:3000 and choose **Try with sample data**.

---

*Everything below is the technical detail.*

Upload one Excel file (Applications, Territories, the brand's existing stores). Every applicant gets a decision (Approved, Conditional, Redirect, Waitlist, Hold or Rejected), a plain-language reason, next steps, a store-readiness timeline and a training plan in their language. A chat panel answers "why" questions and takes new information ("APP-012 has now found a ground-floor space"), re-runs everything and reports every knock-on change.

**Rules decide, AI explains.** The engine in `lib/engine` is plain deterministic TypeScript: same file in, same decisions out. Gemini only reads free-text notes into bounded, quoted signals, rephrases explanations and messages, and turns chat into calls to the engine's tools. If Gemini is missing, slow or throttled, everything still works in rules-only mode.

Six placement rules are re-checked independently after every run (no store on an existing store's pin, one store per pin, never more than the open slots, only in territories with slots, no catchment overlap of 45% or more, one store per applicant).

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000 and choose **Try with sample data**. No login, nothing to configure for rules-only mode.

### Turn the AI on

Copy `.env.example` to `.env.local` and set:

| Variable | What |
|---|---|
| `GEMINI_API_KEY` | Your Gemini key. Read only in server routes; never sent to the browser. |
| `GEMINI_CHAT_MODEL` | Chat, explanations, messages (default `gemini-3.8-flash`) |
| `GEMINI_FAST_MODEL` | Reading applicants' notes at upload (default `gemini-3.5-flash-lite`) |

Then check it live with `npm run ai:smoke`. On Vercel, set the same three variables under Project, Settings, Environment Variables.

## Commands

| | |
|---|---|
| `npm run dev` / `build` / `start` | App |
| `npm run test` | Unit and integration tests |
| `npm run test:stress` | The 34-trap stress file, the judge script, 300-workbook rule fuzzing, messy-file checks |
| `npm run engine -- --why APP-012` | Print every decision for the sample file, and one in full |
| `npm run flags` | Print the data flags for the sample file |
| `npm run ai:smoke` | Live Gemini check (needs `.env.local`) |
| `npm run lint` | ESLint |

## Where things are

- `lib/engine`: parsing, validation, scoring, allocation, rule checker, plans, explanations, what-would-change simulations
- `lib/ai`: Gemini client, note extraction, chat tool loop, rules-only chat, throttle
- `app/api`: `/api/chat`, `/api/extract`, `/api/message`, `/api/status`
- `components`, `lib/state`: the UI and its saved state (browser only)
- `docs`: decisions, spec, UI brief, AI prompts, build plan, test plan

Map tiles are from OpenStreetMap. Coordinates are pin-code centres, so distances and catchments are estimates.
