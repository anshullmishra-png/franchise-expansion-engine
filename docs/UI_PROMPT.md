# UI prompt

## Part A — Anshull's UI prompt (visual style)

<!-- PASTE YOUR UI PROMPT BELOW THIS LINE. Replace this comment. -->

Provided by Anshull as a design brief for a "contact page" (AtlasForms, a forms tool). It is a visual system, not a page spec, so this app borrows the system and keeps its own content. The essentials, with the exact values:

**Signature:** a wide, calm, cartographic LEFT panel beside a narrow DARK form rail, inside one `rounded-2xl` bordered white card (`lg:grid-cols-[1.65fr_1fr]`). Mood: calm, trustworthy, modern, local, human; never a cold generic SaaS form.

**Palette (one accent only, teal):** paper `#f8fafc` · teal 700 `#0f766e` (primary), 800 `#115e59`, 600 `#0d9488`, 500 `#14b8a6`, 50 `#f0fdfa`, 100 `#ccfbf1` · ink 950 `#0b1220`, 900 `#0f172a`, 800 `#1e293b`, 700 `#334155`, 600 `#475569`, 500 `#64748b`, 400 `#94a3b8`, 300 `#cbd5e1`, 200 `#e2e8f0`, 100 `#f1f5f9`. No second accent hue, no loud gradients.

**Shadows:** card `0 1px 2px rgba(15,23,42,.04), 0 8px 24px -12px rgba(15,23,42,.12)` · pop `0 12px 40px -8px rgba(15,23,42,.22)` · rail `0 24px 60px -24px rgba(15,94,89,.45)` (teal button glow).

**Type:** Inter only (400-900). Display headline `font-extrabold tracking-tight leading-[1.05]` at `text-4xl` to `sm:text-5xl`. Eyebrows and small labels are uppercase with `.tracky` (letter-spacing `.14em`), 11-13px, bold. Wordmark: first words ink-900, last word teal-700, `font-extrabold tracking-tight`.

**Shapes:** `rounded-lg` fields, buttons, tiles · `rounded-xl` callouts and inline cards · `rounded-2xl` main card · `rounded-full` eyebrow and label pills. Hairline `ink-200` borders everywhere.

**CSS-only cartographic map texture (`.map-grid`):** background `#e6f1ef` plus four layered linear-gradient grid lines (two fine `rgba(15,118,110,.06)` at 28px, two heavier `rgba(15,118,110,.10)` at 140px), organic `.blob` land masses (`border-radius: 42% 58% 55% 45% / 48% 50% 50% 52%`, teal at .07-.10 alpha), rounded white `.road` strips rotated a few degrees, a white label pill, and a teal pin with a white callout card. Never a real map provider or logo in this decorative texture.

**Dark rail fields (`.field`):** on ink-950, 1px `white/10` border, `white/[.04]` fill, placeholder ink-400, leading icons. On focus: no outline, border teal-500, fill ink-950, ring `0 0 0 4px rgba(20,184,166,.18)`. Primary button teal-700 with the rail glow; on hover lifts `translateY(-1px)` with `0 10px 24px -8px rgba(20,184,166,.6)`.

**Nav:** sticky, `bg-paper/85 backdrop-blur-md`, hairline bottom border, teal logo tile with a `map-pinned` icon, links with a teal underline that grows from 0 to 100% on hover. Light footer closes the page. Lucide icons.

**Copy:** warm, human, plain; no em-dashes.

**How the app applies it:** the chat is the dark rail; the empty state is the map-beside-rail card (upload on the map, how-it-works on the rail); the top bar is the sticky blurred nav; cards, tiles and tables use the card shadow and hairlines; teal is chrome and focus only. The six status colours stay as defined in Part B (they are data, not branding).

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
