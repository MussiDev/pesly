```
/ddw-validate-spec docs/ddw/specs/spec-DISC-001-10a.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 8 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 11 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 1 NFR carry a technical strategy
  ·  10 block(s) found
  ✅ F-SPEC-04: every block lists the files it creates or modifies
  ✅ F-SPEC-05: every block has a verifiable completion criterion
  ✅ F-SPEC-06: every block lists at least one required test
  ✅ F-SPEC-07: every endpoint carries a complete contract
  ✅ F-SPEC-08: every schema declares its constraints
  ✅ F-SPEC-09: every block taking input documents its validation
  ✅ F-SPEC-10: every block documents its error handling
  ✅ F-SPEC-16: every documented error is named by a test
  ✅ F-SPEC-11: dependencies between blocks are declared
  ⚠️ W-SPEC-02: large block, consider splitting: Block 1 (Shared contract and cycle arithmetic) (9 files, 562 words), Block 2 (Migration 0019, schema and rollback) (7 files, 502 words), Block 3 (Domain and use cases) (8 files, 662 words), Block 4 (Persistence adapters and the erasure step) (6 files, 464 words), Block 5 (Accounts guard for linked accounts) (7 files, 229 words), Block 6 (Routes, composition and erasure registry) (8 files, 656 words), Block 8 (Web: card list and create form) (9 files, 297 words), Block 9 (Web: card page with statements) (7 files, 285 words)
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 1 loop(s) since a human decided, under the ceiling of 3; 1 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 1 warnings
Result: PASSED
```
