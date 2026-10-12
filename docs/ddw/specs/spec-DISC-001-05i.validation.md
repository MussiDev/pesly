```
/ddw-validate-spec docs/ddw/specs/spec-DISC-001-05i.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 21 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 62 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 10 NFR carry a technical strategy
  ·  15 block(s) found
  ✅ F-SPEC-04: every block lists the files it creates or modifies
  ✅ F-SPEC-05: every block has a verifiable completion criterion
  ✅ F-SPEC-06: every block lists at least one required test
  ✅ F-SPEC-07: every endpoint carries a complete contract
  ✅ F-SPEC-08: every schema declares its constraints
  ✅ F-SPEC-09: every block taking input documents its validation
  ✅ F-SPEC-10: every block documents its error handling
  ✅ F-SPEC-16: every documented error is named by a test
  ✅ F-SPEC-11: dependencies between blocks are declared
  ⚠️ W-SPEC-02: large block, consider splitting: Block 1 (Shared contracts and error codes) (5 files, 582 words), Block 2 (Data model and migration 0037) (4 files, 717 words), Block 3 (Application layer: SendMovementToGroup, ports and errors) (5 files, 782 words), Block 4 (Persistence adapters, propagation, detach and concurrency tests) (4 files, 1156 words), Block 5 (Movement edit lock and link read) (5 files, 675 words), Block 6 (Route for sending a movement) (2 files, 569 words), Block 8 (Web pure logic for the send screen) (4 files, 663 words), Block 9 (Web send screen) (5 files, 1055 words), Block 12 (Web movements list: send icon, group marker and focus highlight) (5 files, 808 words), Block 14 (End-to-end checks and cross-cutting scans) (3 files, 863 words), Block 15 (Automatic default category resolver) (2 files, 991 words)
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 0 loop(s) since a human decided, under the ceiling of 3; 4 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 1 warnings
Result: PASSED
```
