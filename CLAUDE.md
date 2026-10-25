# CLAUDE.md — Franchise Expansion Engine

Hackathon build (Ops Hackathon, Case 1). Solo builder: Anshull. Submission deadline **26 Oct 2026, 11:59 pm IST**. Deployed link must stay live, with no login, until **28 Oct 2026 end of day IST**.

## What this app does
A franchise brand's expansion team uploads one Excel file (Applications + Territories + fixed Existing stores). For **every** applicant the app decides what should happen, explains why in plain language, and, for those moving forward, gives next steps and a store-readiness and training plan in the applicant's preferred language. A chat panel answers "why" questions and accepts new information ("APP-012 has now found a ground-floor space"), re-runs the engine and reports every knock-on change.

Judges will upload their own messy file, ask why-questions, give new information, and check that no two stores ever share a pin code. They score reasoning and clarity of explanation, not technical depth.

## Read these before working
| File | What it is | Authority |
|---|---|---|
| `docs/DECISIONS.md` | Choices locked with Anshull | Highest. Never change without asking him |
| `docs/SPEC.md` | Full functional spec: parsing, rules, scoring, allocation, onboarding, AI, UI, tests | Detail for everything |
| `docs/UI_PROMPT.md` | Anshull's UI/visual prompt + functional UI checklist | Look & feel |
| `docs/AI_PROMPTS.md` | System prompts and schemas for every Gemini call | AI behaviour |
| `docs/BUILD_PLAN.md` | Phases, in order, with "done when" checks | Work order |
| `docs/TEST_PLAN.md` | Stress-file expectations and the judge simulation script | Definition of done |

If two documents conflict: DECISIONS > SPEC > BUILD_PLAN > UI_PROMPT (UI_PROMPT wins on visual style only, never on functionality).

## Stack (locked)
Next.js (App Router) + TypeScript + Tailwind + shadcn/ui · SheetJS (`xlsx`) · react-leaflet (client-only) · `@google/genai` in server routes only · zod · vitest · GitHub → Vercel auto-deploy.

## Project layout
```
/app                    Next.js routes and pages
/app/api/chat           Gemini chat with function calling
/app/api/extract        Gemini note extraction at upload
/app/api/message        Gemini applicant message drafts
/lib/engine             Pure TS decision engine (no React, no network, no AI)
/lib/engine/parse.ts    Excel → typed input
/lib/engine/validate.ts flags
/lib/engine/geo.ts      haversine, catchment overlap
/lib/engine/score.ts    100-point score
/lib/engine/allocate.ts slot/pin allocation
/lib/engine/plan.ts     timeline, payback, onboarding, training
/lib/engine/explain.ts  deterministic explanations
/lib/engine/invariants.ts H1–H6 checker
/lib/engine/index.ts    runEngine()
/lib/ai                 Gemini client, prompts, zod schemas, fallbacks
/lib/state              client store + localStorage persistence
/components             UI
/data/karnataka_pins.json      pin → lat/lng/area (438 pins)
/public/sample/Stress_Test_Case1.xlsx   "Load sample data"
/public/Case1_Franchise_Test_Data_Format.xlsx  "Download template"
/test-data              stress file + blank template for tests
```

## Guardrails (always follow)
1. **Rules decide, AI explains.** The engine in `/lib/engine` is pure, deterministic TypeScript. No Gemini call may decide a status, a score band or an allocation. AI may only (a) read free text into bounded signals (total ±5 points, each with the quoted source text), (b) phrase explanations and messages, (c) turn chat into engine tool calls.
2. **Never break the placement rules H1–H6** (SPEC §5.3). The invariant checker runs after every engine run. Never weaken or bypass it to make a test pass.
3. **No secrets in the client.** `GEMINI_API_KEY` is read only in server routes. Never prefix it with `NEXT_PUBLIC_`. Never log it.
4. **No login, no paywall, no external accounts** for the judge. Nothing may require sign-in.
5. **Every AI call has a deterministic fallback** and a 20s timeout. If Gemini fails, throttles or returns invalid JSON, the app still works ("Rules-only mode" badge).
6. **The parser must never crash** on any upload. Bad input becomes flags and friendly messages.
7. **Every applicant always gets**: a status, a one-line headline, a plain-language "why", and (if moving forward) next steps and a training plan.
8. **Never invent data.** Chat updates apply only what the user stated; missing details become conditions.
9. **Keep `main` deployable.** Work on a branch per phase, run `npm run test` and `npm run build` before merging, then push. Commit after each phase.
10. **Don't change locked decisions** (DECISIONS.md) or the scoring numbers (SPEC §4–§5) without asking Anshull. If something seems wrong, flag it and propose the change.
11. **Brand framing:** call it "the brand". The format is benchmarked on a Lenskart-style store, mentioned only in the Assumptions drawer and the empty state. Don't use Lenskart's name or logo anywhere else.
12. **Stay in scope.** Don't add features beyond SPEC/DECISIONS without asking. Prefer finishing and testing over adding.
13. **Ask before installing** anything that needs a paid account or a new external service.
14. Windows dev machine: use cross-platform npm scripts (no bash-only syntax in package.json).

## Commands
- `npm run dev` · `npm run build` · `npm run test` (vitest) · `npm run test:stress` (stress-file assertions) · `npm run lint`
- Slash commands in `.claude/commands/`: `/verify` (tests + build + invariants), `/judge-sim` (run the judge script against a URL), `/next-phase` (pick up the next phase from BUILD_PLAN.md).

## Env vars
`GEMINI_API_KEY`, `GEMINI_CHAT_MODEL` (default `gemini-3.8-flash`), `GEMINI_FAST_MODEL` (default `gemini-3.5-flash-lite`). See `.env.example`.
