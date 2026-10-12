```
/ddw-validate-spec docs/ddw/specs/spec-DISC-001-09a.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 16 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 50 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 4 NFR carry a technical strategy
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
  ⚠️ W-SPEC-02: large block, consider splitting: Block 0 (Shared contracts, range and month helpers) (4 files, 582 words), Block 1 (Exchange rate history: migration, write path and seed) (5 files, 619 words), Block 2 (Reports module skeleton, routes, preferences and filter checks) (5 files, 657 words), Block 3 (Flow core: conversion rules and the aggregated readers) (6 files, 795 words), Block 5 (Expenses by category report) (4 files, 543 words), Block 6 (Net worth sources: accounts, groups, investments and installment debt) (4 files, 684 words), Block 7 (Net worth report: rate lookup, point assembly and use case) (6 files, 551 words), Block 8 (Composition, ownership flows and benchmark) (5 files, 675 words)
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 0 loop(s) since a human decided, under the ceiling of 3; 0 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 1 warnings
Result: PASSED
```
