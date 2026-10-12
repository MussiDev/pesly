```
/ddw-validate-spec docs/ddw/specs/spec-DISC-001-05j.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 13 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 30 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 6 NFR carry a technical strategy
  ·  11 block(s) found
  ✅ F-SPEC-04: every block lists the files it creates or modifies
  ✅ F-SPEC-05: every block has a verifiable completion criterion
  ✅ F-SPEC-06: every block lists at least one required test
  ✅ F-SPEC-07: every endpoint carries a complete contract
  ✅ F-SPEC-08: every schema declares its constraints
  ✅ F-SPEC-09: every block taking input documents its validation
  ✅ F-SPEC-10: every block documents its error handling
  ✅ F-SPEC-16: every documented error is named by a test
  ✅ F-SPEC-11: dependencies between blocks are declared
  ⚠️ W-SPEC-02: large block, consider splitting: Block 2 (API: category and range filter on the expense list) (6 files, 503 words), Block 3 (API: group expense summary) (7 files, 660 words), Block 5 (Pure view logic: categories, months and summary lines) (6 files, 656 words), Block 6 (Presentational components and base catalog keys) (7 files, 482 words), Block 7 (Expense list: chips, filters and states) (6 files, 533 words), Block 11 (End-to-end checks and final scans) (3 files, 699 words)
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 0 loop(s) since a human decided, under the ceiling of 3; 0 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 1 warnings
Result: PASSED
```
