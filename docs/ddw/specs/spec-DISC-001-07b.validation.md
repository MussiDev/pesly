```
/ddw-validate-spec docs/ddw/specs/spec-DISC-001-07b.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 6 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 16 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 2 NFR carry a technical strategy
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
  ⚠️ W-SPEC-02: large block, consider splitting: Block 1 (Domain: price conversion, snapshot dates and provider failures) (3 files, 534 words), Block 2 (Application: ports and use cases) (3 files, 954 words), Block 3 (Persistence: migration 0015, repositories and erasure registry) (9 files, 1786 words), Block 4 (Provider adapters and worker environment) (7 files, 964 words), Block 5 (Jobs and worker wiring) (5 files, 612 words), Block 6 (Market price in the holding response and the switch to automatic) (12 files, 1312 words), Block 7 (Web: manual price warning and switch to automatic) (6 files, 732 words), Block 8 (Cross-cutting checks and end-to-end step) (3 files, 724 words)
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 0 loop(s) since a human decided, under the ceiling of 3; 2 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 1 warnings
Result: PASSED
```
