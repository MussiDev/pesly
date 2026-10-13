```
/ddw-validate-spec docs/ddw/specs/spec-FEAT-011.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 13 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 27 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 6 NFR carry a technical strategy
  ·  8 block(s) found
  ✅ F-SPEC-04: every block lists the files it creates or modifies
  ✅ F-SPEC-05: every block has a verifiable completion criterion
  ✅ F-SPEC-06: every block lists at least one required test
  ✅ F-SPEC-07: every endpoint carries a complete contract
  ✅ F-SPEC-08: every schema declares its constraints
  ✅ F-SPEC-09: every block taking input documents its validation
  ✅ F-SPEC-10: every block documents its error handling
  ✅ F-SPEC-16: every documented error is named by a test
  ✅ F-SPEC-11: dependencies between blocks are declared
  ⚠️ W-SPEC-02: large block, consider splitting: Block 2 (Budgets domain, row types and port) (6 files, 394 words), Block 3 (Drizzle spending reader) (4 files, 586 words), Block 4 (Use cases, callers and response) (7 files, 426 words), Block 5 (Budget screens: card note and installment notice) (6 files, 238 words), Block 6 (Dashboard available money: API) (10 files, 599 words), Block 7 (Dashboard available money: web and i18n) (7 files, 259 words)
  ⚠️ W-SPEC-03: schema changes with no rollback or reverse-migration consideration
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 1 loop(s) since a human decided, under the ceiling of 3; 1 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 2 warnings
Result: PASSED
```
