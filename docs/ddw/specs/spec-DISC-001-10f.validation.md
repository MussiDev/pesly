```
/ddw-validate-spec docs/ddw/specs/spec-DISC-001-10f.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 4 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 9 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 2 NFR carry a technical strategy
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
  ⚠️ W-SPEC-02: large block, consider splitting: Block 2 (Migration 0030 and schema) (7 files, 674 words), Block 4 (Card reminder days: repository, presenter and routes) (4 files, 519 words), Block 5 (Reminder domain, ports and use case) (6 files, 763 words), Block 6 (Notice text and publisher adapter (notices module)) (5 files, 544 words), Block 7 (Source adapter, job and factory) (4 files, 748 words), Block 11 (End to end and guards) (4 files, 906 words)
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 0 loop(s) since a human decided, under the ceiling of 3; 0 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 1 warnings
Result: PASSED
```
