# Build plan — phase by phase

Each phase: paste the **Prompt** into Claude Code (or run `/next-phase`). Don't start the next phase until **Done when** is true. Commit and push after every phase; Vercel redeploys `main` automatically.

Rough clock (start ~10:30 pm): P0–P2 by 2 am · P3–P4 by 5 am · P5–P6 by 8 am · P7 by 11 am · then video + deck.

---

## P0 — Scaffold and deploy (30 min)
**Prompt:** "Read CLAUDE.md and docs/DECISIONS.md. Scaffold the Next.js App Router project in this folder (TypeScript, Tailwind, shadcn/ui, ESLint, vitest) without deleting existing files in /docs, /data, /test-data, /public. Add npm scripts: dev, build, start, lint, test, test:stress. Create a placeholder home page titled 'Franchise Expansion Engine'. Add .env.example usage. Make sure `npm run build` passes. Then stop and tell me the steps to push to GitHub and connect Vercel."
**Done when:** public Vercel URL loads in an incognito window; `GEMINI_API_KEY`, `GEMINI_CHAT_MODEL`, `GEMINI_FAST_MODEL` set in Vercel env.

## P1 — Parser, reference data, validation (1.5 h)
**Prompt:** "Implement /lib/engine/parse.ts, reference constants, and /lib/engine/validate.ts exactly per docs/SPEC.md §2, §3 and §5.1. Include the template-example-row rule, fuzzy sheet/header matching, blank-row skipping, number/pin normalisation, all flags with questions. Write vitest tests from docs/TEST_PLAN.md §1 (parser + validation). Add a script that loads test-data/Stress_Test_Case1.xlsx and prints each applicant's flags as a table."
**Done when:** stress file parses with 34 applications + 12 territories; the example row is ignored with a notice; APP-007, APP-024, APP-029, APP-030 have blocker flags; TER-10 has a tier-mismatch flag; 570002 multi-territory flagged; blank template parses to 0 applicants without error.

## P2 — Geo, score, allocation, invariants (2 h)
**Prompt:** "Implement geo.ts (haversine, catchment overlap), score.ts, allocate.ts and invariants.ts per SPEC §5.2–§5.5 and DECISIONS D5–D9. Then runEngine() in index.ts returning the Decision records from SPEC §6 (explanations can be placeholders for now). Add the stress assertions from docs/TEST_PLAN.md §2 as `npm run test:stress`, and the invariant fuzz test (300 random workbooks)."
**Done when:** all stress assertions and fuzz tests pass; invariants hold; a printed table of status/score/allocation for the stress file looks sensible (check the APP-012 vs APP-013 numbers: ~66 vs ~68).

## P3 — Plans and explanations (1 h)
**Prompt:** "Implement plan.ts (realistic timeline, payback, next steps, onboarding timeline, training plan with nearest-store shadowing and language) per SPEC §5.6, §5.7 and §7, and explain.ts (deterministic explanations, competitor comparisons, 'what would change it' via simulation) per SPEC §6. Every applicant must have a headline and a why. Add tests."
**Done when:** every stress applicant has a complete Decision record; explanations read naturally and contain the deciding numbers; APP-012 shows the "~74 if you find a ground-floor space" line.

## P4 — UI (2.5 h)
**Prompt:** "Build the UI per docs/UI_PROMPT.md (Part A for style, Part B checklist for what must exist) and SPEC §9: top bar, empty state, upload, Overview, Applications table + detail drawer, Territories, Change log, Assumptions drawer, Export to Excel, Start over, localStorage persistence, rules-verified badge. Chat panel shell can be static for now. Map tab placeholder. No AI yet."
**Done when:** whole flow works without AI: load sample → every tab populated → drawer complete → edit a field inline → decisions re-run → change log + undo → refresh keeps state → export downloads.

## P5 — Gemini layer (2 h)
**Prompt:** "Implement /lib/ai and the routes /api/extract, /api/chat, /api/message per docs/AI_PROMPTS.md: @google/genai client, structured output for extraction, function-calling loop for chat with the engine tools, zod validation, 20s timeouts, per-IP throttle (30/min), and the deterministic fallbacks (SPEC §8.5). Wire the chat panel (suggested chips, clickable IDs, update replies with the four-part structure, diff applied to state + change log), 'Explain simply', and message drafts with language toggle."
**Done when:** docs/TEST_PLAN.md §3 judge script passes locally with AI on, and again with GEMINI_API_KEY removed (rules-only mode).

## P6 — Map (1 h)
**Prompt:** "Implement the Map tab and the drawer mini-map with react-leaflet (client-only dynamic import) per SPEC §9: existing stores, allocations by status colour, waitlist/hold grey, catchment circle toggle, dashed redirect arrows, city filter, click-to-open drawer."
**Done when:** Bengaluru view shows ST-01..05 with circles; redirects show arrows; no SSR errors in `npm run build`.

## P7 — Hardening and polish (2 h)
**Prompt:** "Run /verify. Then go through docs/TEST_PLAN.md §4 deployed checks against the Vercel URL and fix everything that fails. Polish copy for clarity. Check mobile layout. Don't add new features."
**Done when:** every item in TEST_PLAN.md is ticked on the deployed URL in incognito.

---

## If time runs short (cut in this order, last first)
1. Mini-map in drawer (keep the Map tab)
2. Gantt styling (a simple list of dated steps is fine)
3. Message drafts in Kannada/Hindi (keep English template)
Never cut: parser robustness, invariants, explanations, chat updates with knock-on diff, rules-only fallback.
