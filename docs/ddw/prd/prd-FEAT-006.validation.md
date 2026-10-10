```
/ddw-validate-prd docs/ddw/prd/prd-FEAT-006.md — PASSED
────────────────────────────────────────────────────────────────
  ✅ F-PRD-08: all mandatory sections present
  ✅ F-PRD-05: 11 FR, 6 NFR, 22 AC — unique, gapless
  ✅ F-PRD-01: every FR is validated by at least one AC
  ✅ F-PRD-03: every NFR carries a quantitative value
  ✅ F-PRD-04: Out of Scope has explicit items
  ✅ F-PRD-06: no ambiguous verbs in requirements
  ✅ F-PRD-09: every AC matches an EARS pattern
  👁  F-PRD-02 (binary ACs), F-PRD-07 (undeclared cross-references),
      W-PRD-01 (FR with no rationale) and W-PRD-03 (passive voice) are
      MANUAL: judge them and say so explicitly in your report.
      A rule the script names and never prints is one nobody judges.
  ✅ F-PRD-LOOP: 0 loop(s) since a human decided, under the ceiling of 3; 0 in total for this document
────────────────────────────────────────────────────────────────
Total: 8 passed, 0 failed, 0 warnings
Result: PASSED
```

Manual rules judged by the author:
- F-PRD-02: every AC names one observable outcome (a status code, a stored value, a rendered message or the absence of a request), so each is binary. Judged: PASS.
- F-PRD-07: every external reference (DISC-001-02a, PRD 01, PRD 03, FEAT-004/005) is declared under Dependencies. Judged: PASS.
- W-PRD-01 and W-PRD-03: each FR traces to the Context (wrong opening balance cannot be corrected); requirements use the active voice. Judged: no warnings.
