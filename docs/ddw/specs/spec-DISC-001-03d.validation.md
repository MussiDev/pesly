```
/ddw-validate-spec docs/ddw/specs/spec-DISC-001-03d.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 4 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 7 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 4 NFR carry a technical strategy
  ·  7 block(s) found
  ✅ F-SPEC-04: every block lists the files it creates or modifies
  ✅ F-SPEC-05: every block has a verifiable completion criterion
  ✅ F-SPEC-06: every block lists at least one required test
  ✅ F-SPEC-07: every endpoint carries a complete contract
  ✅ F-SPEC-08: every schema declares its constraints
  ✅ F-SPEC-09: every block taking input documents its validation
  ✅ F-SPEC-10: every block documents its error handling
  ✅ F-SPEC-16: every documented error is named by a test
  ✅ F-SPEC-11: dependencies between blocks are declared
  ⚠️ W-SPEC-02: large block, consider splitting: Block 1 (Shared contracts) (5 files, 827 words), Block 2 (Domain, ports and use cases) (9 files, 681 words), Block 3 (Persistence: tags, migration 0017 and the repositories) (7 files, 1364 words), Block 4 (HTTP and composition) (6 files, 646 words), Block 5 (Web: tags on the entry screen) (8 files, 729 words), Block 6 (Web: filters on the movement list) (7 files, 623 words), Block 7 (Performance, end-to-end flow and scans) (5 files, 1162 words)
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 0 loop(s) since a human decided, under the ceiling of 3; 2 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 1 warnings
Result: PASSED
```
