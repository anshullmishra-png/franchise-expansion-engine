Run the full verification for this project and report results as a short checklist:
1. `npm run lint`
2. `npm run test`
3. `npm run test:stress` — list any failed assertion with the applicant ID and what was expected vs actual
4. `npm run build`
5. Confirm the invariant checker (H1–H6) passes on the stress file and on the fuzz run.
Fix nothing automatically unless the fix is obvious and inside the current phase's scope; otherwise list the failures and proposed fixes and wait for me.
