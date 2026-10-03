```
/ddw-validate-spec docs/ddw/specs/spec-DISC-001-03c.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 9 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 15 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 4 NFR carry a technical strategy
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
  ⚠️ W-SPEC-02: large block, consider splitting: Block 1 (Shared contracts and the implied-rate helper) (5 files, 648 words), Block 2 (Domain, ports and use cases) (6 files, 800 words), Block 3 (Persistence: migration 0016, schema and repository) (6 files, 946 words), Block 5 (HTTP and composition) (4 files, 753 words), Block 6 (Web client and the entry screen) (10 files, 824 words), Block 8 (End-to-end flow, performance and cross-cutting scans) (4 files, 737 words)
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 0 loop(s) since a human decided, under the ceiling of 3; 0 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 1 warnings
Result: PASSED
```
