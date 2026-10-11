```
/ddw-threat-modeling docs/ddw/security/threat-DISC-001-04e.md — FAILED (1 FAIL)
────────────────────────────────────────────────────────────────
  ❌ F-TM-01: component with no STRIDE analysis: `packages/shared/src/groups/expense.ts`, `settlement.ts`, `conflict.ts`, `apps/api/src/groups/infrastructure/db/schema.ts` and migration 0031, `apps/api/src/groups/application/update-group-expense.ts`, `delete-group-expense.ts`, `update-settlement.ts`, `delete-settlement.ts`, `apps/api/src/groups/infrastructure/db/drizzle-group-expense-repository.ts`, `drizzle-group-settlement-repository.ts`, `apps/api/src/groups/infrastructure/http/group-routes.ts`, `apps/web/src/lib/api-client.ts` (group calls), `apps/web/src/lib/local-store/group-queue.ts`, `apps/web/src/lib/sync/sync-queue.ts` and `sync-pass.ts`, `apps/web/src/features/groups/*`
  ✅ F-TM-02: trust boundaries are declared
  ✅ F-TM-03: all 8 identified threats carry a mitigation or an acceptance
  ✅ F-TM-04: no accepted risks to approve
  ✅ F-TM-05: all 4 data item(s) are classified
  ✅ F-TM-07: PII/credentials specify encryption at rest and in transit
  ✅ F-TM-06: the model cites 13 concrete element(s) of the spec
  👁  Whether each STRIDE entry is CORRECT, and whether a mitigation actually
      mitigates, are MANUAL: judge them and say so explicitly in your report.
────────────────────────────────────────────────────────────────
Total: 6 passed, 1 failed, 0 warnings
Result: FAILED (1 FAIL)
```
