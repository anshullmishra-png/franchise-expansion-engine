# UI prompt

## Part A — Anshull's UI prompt (visual style)

<!-- PASTE YOUR UI PROMPT BELOW THIS LINE. Replace this comment. -->

_(not yet provided — until it is, use a clean, professional ops-tool style with shadcn/ui defaults and the status colours below)_

<!-- END OF UI PROMPT -->

---

## Part B — Functional UI checklist (must exist whatever the visual style)

Part A decides how things look. Part B decides what must be on screen. If Part A conflicts with Part B, keep Part B's functionality and follow Part A's style. Detail: `docs/SPEC.md` §9.

### Status colours (keep consistent everywhere: chips, map markers, charts)
Approved = green · Conditional = teal · Redirect = blue · Waitlist = amber · Hold = purple · Rejected = red. Never rely on colour alone: every chip also shows the status word.

### Global
- [ ] Top bar: "Franchise Expansion Engine" · Load sample data · Upload Excel · Download template · Assumptions · Export (.xlsx) · Start over · "✓ All 6 placement rules verified" badge · "Rules-only mode" badge when AI is unavailable
- [ ] Chat panel on the right, collapsible, persistent across tabs, with suggested-question chips; APP-/TER- IDs in answers are clickable and open the drawer
- [ ] Works at 1280px+ and is usable on a phone (chat becomes a bottom sheet)
- [ ] Friendly empty state: drag-and-drop upload, "Try with sample data", 3-line explanation, one line on the brand benchmark
- [ ] Friendly errors for wrong file types or unreadable sheets; never a blank screen
- [ ] Data-quality banners (e.g. "Ignored the template's example row [Include it]")

### Tabs
- [ ] **Overview**: status count tiles · slots filled per territory · Data-quality alerts · Needs your attention (holds with questions, conditions due soon) · Unfilled-slot insights
- [ ] **Applications**: sortable, filterable table (ID, name, city · pin (area), territory, status chip, score bar, payback, headline). Search box. Status filter chips
- [ ] **Territories**: card per territory — slots filled/total, allocated stores, waitlist queue, viable pins left, flags
- [ ] **Map**: existing stores, new allocations by status colour, waitlist/hold grey, catchment circle toggle, dashed redirect arrows, city filter, click → drawer
- [ ] **Change log**: each update (time, source text, field diffs, status diffs) with Undo

### Applicant detail drawer
- [ ] Headline decision + plain-language "Why" (+ "Explain simply" AI button)
- [ ] Score breakdown (5 components + AI signals) with reasons; AI-read signals show the quoted text
- [ ] Competitors and "why they won" (point difference by component)
- [ ] Cannibalisation table (store, km, overlap %, band) + mini map
- [ ] Conditions with deadlines · Questions for applicant (Hold) · What would change the decision
- [ ] Next steps (owner, due date) · Timeline to opening (Gantt-style) · Training plan (language, modules, shadowing store, buddy)
- [ ] Applicant message draft with language toggle (Kannada / Hindi / English) and copy button
- [ ] Inline field editing (same update path as chat) + history of changes for this applicant

### Assumptions drawer
- [ ] Every value in SPEC §4, grouped (Investment & revenue · Catchment & cannibalisation · Space · Thresholds), with reset-to-default; editing re-runs the engine and shows how many decisions changed
- [ ] One line: "Store format benchmarked on a Lenskart-style specialty retail store"
