```
/ddw-validate-spec docs/ddw/specs/spec-DISC-001-09c.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 23 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 50 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 8 NFR carry a technical strategy
  ·  9 block(s) found
  ✅ F-SPEC-04: every block lists the files it creates or modifies
  ✅ F-SPEC-05: every block has a verifiable completion criterion
  ✅ F-SPEC-06: every block lists at least one required test
  ✅ F-SPEC-07: every endpoint carries a complete contract
  ✅ F-SPEC-08: every schema declares its constraints
  ✅ F-SPEC-09: every block taking input documents its validation
  ✅ F-SPEC-10: every block documents its error handling
  ✅ F-SPEC-16: every documented error is named by a test
  ✅ F-SPEC-11: dependencies between blocks are declared
  ⚠️ W-SPEC-02: large block, consider splitting: Block 0 (Dashboard calls, 09b parser and adapter, formatters and catalogs) (7 files, 1247 words), Block 2 (Theme: light, dark or system) (4 files, 543 words), Block 3 (KPI cards, delta chips and the month notice) (4 files, 503 words), Block 4 (Net worth card and area chart) (6 files, 948 words), Block 5 (Category, budgets, upcoming and group cards) (5 files, 624 words), Block 6 ("Do these first", device-queue items, insight and first steps) (6 files, 597 words), Block 7 (Dashboard container, screen layout and the new home) (6 files, 849 words), Block 8 (Browser tests, scans, cleanup and final verification) (7 files, 1177 words)
  ⚠️ W-SPEC-03: schema changes with no rollback or reverse-migration consideration
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 0 loop(s) since a human decided, under the ceiling of 3; 0 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 2 warnings
Result: PASSED
```
