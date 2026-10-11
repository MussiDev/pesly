```
/ddw-validate-spec docs/ddw/specs/spec-DISC-001-10e.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 4 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 11 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 3 NFR carry a technical strategy
  ·  12 block(s) found
  ✅ F-SPEC-04: every block lists the files it creates or modifies
  ✅ F-SPEC-05: every block has a verifiable completion criterion
  ✅ F-SPEC-06: every block lists at least one required test
  ✅ F-SPEC-07: every endpoint carries a complete contract
  ✅ F-SPEC-08: every schema declares its constraints
  ✅ F-SPEC-09: every block taking input documents its validation
  ✅ F-SPEC-10: every block documents its error handling
  ✅ F-SPEC-16: every documented error is named by a test
  ✅ F-SPEC-11: dependencies between blocks are declared
  ⚠️ W-SPEC-02: large block, consider splitting: Block 2 (Migration 0027 and schema) (7 files, 821 words), Block 3 (Card domain and link use case) (8 files, 565 words), Block 4 (Automatic debit domain and use case) (7 files, 1069 words), Block 5 (Linking adapters: repository, lookups, links, erasure) (6 files, 517 words), Block 6 (Job adapters: source, claim log, transfer recorder) (5 files, 750 words), Block 7 (Job loop and factory) (3 files, 662 words), Block 8 (HTTP route and composition) (5 files, 539 words), Block 12 (End to end and guards) (5 files, 750 words)
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 0 loop(s) since a human decided, under the ceiling of 3; 0 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 1 warnings
Result: PASSED
```
