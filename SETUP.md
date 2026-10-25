# Setup — read this first (Anshull)

## 1. One-time setup (15 min)
1. Unzip this folder somewhere simple, e.g. `C:\dev\franchise-expansion-engine`.
2. Open `docs/UI_PROMPT.md` and paste your UI prompt into Part A (between the two comment lines). Save.
3. Copy `.env.example` to `.env.local` and put your Gemini key in it.
4. In Google AI Studio, confirm the two model IDs (`gemini-3.8-flash`, `gemini-3.5-flash-lite`) are available on your key. If not, change them in `.env.local` (no code change needed). Set a budget alert on the key in Google Cloud.
5. Create an empty **private** GitHub repo named `franchise-expansion-engine` (no README).
6. Open a terminal in the folder and start Claude Code: `claude`

## 2. Build
- Type `/next-phase` and follow it phase by phase (P0 → P7 in `docs/BUILD_PLAN.md`). Or paste each phase's Prompt yourself.
- After P0, Claude Code will give you the GitHub push commands. Then in Vercel: **Add New → Project → import the repo** → add the three env vars (`GEMINI_API_KEY`, `GEMINI_CHAT_MODEL`, `GEMINI_FAST_MODEL`) → Deploy. From then on, every push to `main` redeploys.
- Run `/verify` whenever you want a health check. Run `/judge-sim https://your-app.vercel.app` once deployed.

## 3. Optional: Superdesign for the UI
If you want mockups before P4:
```
npm install -g @superdesign/cli@latest
superdesign login
npx skills add superdesigndev/superdesign-skill
```
Then in Claude Code: `/superdesign help me design <your UI prompt>`, pick a design, and tell Claude Code to implement it in P4 while meeting the checklist in `docs/UI_PROMPT.md` Part B. Check its pricing first.

## 4. Before you submit
- Open the Vercel URL in an incognito window and on your phone, and tick `docs/TEST_PLAN.md` §4.
- Don't push risky changes to `main` after you've recorded the demo video.

## What's in the folder
| Path | Purpose |
|---|---|
| `CLAUDE.md` | Claude Code reads this every session: context, stack, guardrails |
| `docs/DECISIONS.md` | Everything we locked tonight |
| `docs/SPEC.md` | Full functional spec |
| `docs/UI_PROMPT.md` | Your UI prompt + must-have UI checklist |
| `docs/AI_PROMPTS.md` | Gemini prompts and schemas |
| `docs/BUILD_PLAN.md` | Phases with prompts and done-checks |
| `docs/TEST_PLAN.md` | Stress assertions + judge script |
| `.claude/commands/` | `/next-phase`, `/verify`, `/judge-sim` |
| `data/karnataka_pins.json` | Pin → lat/lng/area for 438 pins |
| `test-data/` | Stress file (34 traps) + blank judge template |
| `public/` | Sample file for the "Load sample data" button + template download |
