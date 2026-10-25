Run the judge simulation from docs/TEST_PLAN.md §3 against $ARGUMENTS (a URL; default http://localhost:3000).
Drive it through the app's API: load test-data/Stress_Test_Case1.xlsx through the same parsing path the UI uses, then send each chat message to /api/chat in order, carrying state forward exactly as the client does.
For each step report: the question, a one-line summary of the reply, PASS/FAIL against the expectation in TEST_PLAN.md, and for updates the list of status changes.
Then repeat steps 1, 9, 12 and 16 forcing rules-only mode (send header `x-force-fallback: 1`, which /api/chat must honour in non-production builds only).
End with a summary table and the failures to fix.
