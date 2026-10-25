# Test plan

## 1. Unit tests (vitest)
- **Parser:** template example row ignored (and included via toggle); blank rows skipped down to row 500; pins given as `570001.0`; header text variants; combined "City · State · Pin code" column; extra sheet "Test key (ours)" ignored; missing Existing stores sheet → built-in list; non-xlsx file → friendly error; blank template → 0 applicants, no crash.
- **Validation:** one test per flag code in SPEC §5.1.
- **Geo:** haversine sanity (560001→560038 ≈ 4.6 km); overlap d=0 → 100%, d ≥ 2r → 0%, symmetric.
- **Score:** each band boundary in SPEC §5.4 (e.g. investment ratio exactly 0.60, 0.85, 1.00, 1.10, 1.25).
- **Allocation:** tie-breaks; redirect penalty only when a site would be lost; pass 1 before pass 2; H6 same person.
- **Invariants:** H1–H6 each caught by a deliberately broken allocation.

## 2. Stress file assertions (`npm run test:stress`, file `test-data/Stress_Test_Case1.xlsx`)
- APP-001 example row ignored by default.
- HOLD: APP-007 (city/pin mismatch), APP-024 (duplicate of APP-023), APP-029 (missing fields + invalid pin), APP-030 (investment outlier/contradiction).
- REJECTED: APP-014 (investment < 60% of Tier 2 need), with a "what would change it" line.
- No allocation at 560001, 560034, 560038, 560066, 560076, 570009, 570017, 575001, 580020, 590001.
- TER-10 treated as Tier 3 (APP-018 ratio = 18/22, not 18/28).
- 570002 flagged as in two territories.
- APP-003 and APP-035 (same person) never both allocated.
- TER-12 (0 slots) gets nothing; APP-027 redirected elsewhere or waitlisted.
- APP-008 and APP-009 not both allocated at their own pins (≈2.5 km apart in Mysuru).
- APP-016 and APP-017 not both allocated (TER-09 has one slot).
- APP-026 not allocated (score < 55); TER-03 either unfilled or filled by a redirect.
- APP-012 initially loses TER-07 to APP-013; after update `floor=Ground, spaceAvailable=Identified (ownership unconfirmed)`, APP-012 holds TER-07 and APP-013 becomes Waitlist #1.
- Every applicant has a status, headline and non-empty why.
- Invariants H1–H6 pass.

## 3. Judge simulation script (`/judge-sim`, run locally and on the deployed URL)
Load sample data, then ask in the chat:
1. Why is APP-007 on hold?
2. Why is APP-009 not approved? *(or whichever of APP-008/009 lost)*
3. Why did APP-002 get 560095 and not APP-003?
4. What does APP-008 need to do next?
5. How will APP-006 be trained?
6. Which territories have unfilled slots, and why?
7. Is any new store planned in a pin that already has a store?
8. What's APP-017's payback period?
9. **APP-012 has now found a ground-floor space** → APP-012 up, APP-013 bumped, four-part reply.
10. APP-030's investment is actually 30 lakh → hold clears, re-ranked.
11. APP-010 has moved to a ground-floor unit of 400 sq ft → competes with APP-011.
12. APP-002 has withdrawn → next in line moves into TER-01.
13. TER-03 now has 2 open slots → re-allocation.
14. APP-033's bank loan was sanctioned → condition clears.
15. What if APP-014 found a co-investor and can invest 30 lakh? → what_if, nothing committed.
16. Tell me about APP-999 → graceful "doesn't exist".
17. Undo the last change → state restored.
Repeat 1, 9, 12 and 16 with `GEMINI_API_KEY` unset → rules-only mode still answers.

## 4. Deployed checks (incognito, then phone)
- [ ] Loads with no login, no console errors
- [ ] Load sample data works; upload the stress file manually works
- [ ] Upload the blank template → friendly empty result
- [ ] Upload a .pdf/.csv → friendly error
- [ ] Judge script §3 passes on the live URL
- [ ] Refresh keeps state; Start over clears it
- [ ] Export downloads and opens in Excel
- [ ] Map renders; drawer opens from map
- [ ] Assumption change (Tier 2 catchment 3 → 2 km) re-runs and reports changes
- [ ] Mobile: table scrolls, drawer and chat usable
- [ ] Gemini budget alert/quota set; throttle returns friendly message
