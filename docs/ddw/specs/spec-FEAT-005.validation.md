```
/ddw-validate-spec docs/ddw/specs/spec-FEAT-005.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-SPEC-01: all 15 FR from the PRD are referenced by a block
  ✅ F-SPEC-02: all 41 AC from the PRD are named by at least one test
  ✅ F-SPEC-03: all 9 NFR carry a technical strategy
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
  ⚠️ W-SPEC-02: large block, consider splitting: Block 2 (New primitives: avatar, pill tabs, chip, circular action, donut chart) (6 files, 496 words), Block 3 (Restyled existing primitives) (15 files, 439 words), Block 4 (Shell: floating bottom bar and top navigation card) (10 files, 588 words), Block 5 (Merchant and asset logo catalogs and resolvers) (12 files, 817 words), Block 6 (Home: balance card, quick actions, accounts section, recent movements) (10 files, 535 words), Block 7 (Movements screens and preselected type) (11 files, 498 words), Block 9 (Investments: logos, composition donut and gain markers) (9 files, 608 words), Block 12 (Reference page, catalog parity, accessibility and performance) (5 files, 526 words)
  👁  F-SPEC-12 (contradicts the PRD) and F-SPEC-13 (terminology diverging from
      the PRD) are MANUAL: judge them and say so explicitly in your report.
  ✅ F-SPEC-LOOP: 2 loop(s) since a human decided, under the ceiling of 3; 2 in total for this document
────────────────────────────────────────────────────────────────
Total: 13 passed, 0 failed, 1 warnings
Result: PASSED
```
