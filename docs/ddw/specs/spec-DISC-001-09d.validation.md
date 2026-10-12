```
/ddw-validate-spec docs/ddw/specs/spec-DISC-001-09d.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 23 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 50 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 9 NFR carry a technical strategy
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
  ⚠️ W-SPEC-02: large block, consider splitting: Block 1 (Shared helpers, api-client calls and catalogs) (9 files, 1219 words), Block 2 (Shared screens pieces, request hook, layout and tab bar) (12 files, 1069 words), Block 3 (Expenses by category screen) (5 files, 579 words), Block 5 (Net worth screen) (6 files, 549 words), Block 6 (Navigation entry, dashboard links and return after sign-in) (6 files, 431 words), Block 8 (Browser tests with typed fixtures) (3 files, 748 words)
  ⚠️ W-SPEC-03: schema changes with no rollback or reverse-migration consideration
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 0 loop(s) since a human decided, under the ceiling of 3; 0 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 2 warnings
Result: PASSED
```
