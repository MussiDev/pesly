```
/ddw-validate-spec C:/Users/Joako/Desktop/argent-06c/docs/ddw/specs/spec-DISC-001-06c.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 8 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 28 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 2 NFR carry a technical strategy
  ·  5 block(s) found
  ✅ F-SPEC-04: every block lists the files it creates or modifies
  ✅ F-SPEC-05: every block has a verifiable completion criterion
  ✅ F-SPEC-06: every block lists at least one required test
  ✅ F-SPEC-07: every endpoint carries a complete contract
  ✅ F-SPEC-08: every schema declares its constraints
  ✅ F-SPEC-09: every block taking input documents its validation
  ✅ F-SPEC-10: every block documents its error handling
  ✅ F-SPEC-16: every documented error is named by a test
  ✅ F-SPEC-11: dependencies between blocks are declared
  ⚠️ W-SPEC-02: large block, consider splitting: Block 1 (Shared contract and error code) (6 files, 369 words), Block 2 (Pure calculation in the domain) (4 files, 584 words), Block 3 (Ports, SQL adapters and migration 0035) (7 files, 809 words), Block 4 (Use cases and routes) (7 files, 676 words), Block 5 (Benchmark, end-to-end flow and float scan) (3 files, 814 words)
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 0 loop(s) since a human decided, under the ceiling of 3; 0 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 1 warnings
Result: PASSED
```
