# Threat model DISC-001-06d: Budget Alerts

| Field | Value |
|-------|-------|
| Ticket | DISC-001-06d |
| Spec | docs/ddw/specs/spec-DISC-001-06d.md |
| Tier | FEATURE |
| Date | 2026-10-11 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/movements/application/best-effort-expense-saved.ts` | Block 4 |
| `apps/api/src/budgets/application/evaluate-budget-alerts.ts` | Block 3 |
| `apps/api/src/budgets/infrastructure/db/drizzle-budget-alert-store.ts` | Block 3 |
| `apps/api/src/budgets/infrastructure/db/schema.ts` | Block 2 |
| `apps/api/src/notices/domain/notice-text.ts` | Block 1 |

## Trust boundaries
- Browser → API (`POST /movements`, `PUT /movements/:id`): untrusted body and session cookies cross it;
  the shared `validate` middleware, `requireSession` and `requireVerifiedEmail` guard it. This ticket
  adds no input on that boundary: the evaluation reads only what the saved movement already stores.
- Movements → budgets (the `ExpenseSavedListener` port): the movements module hands over the
  `AccessScope` of the saved expense, a category id and a date; the budgets module is trusted to use
  that scope only, and the movements module trusts no result from it.
- Budgets → notices: the budgets store writes a notice row for the scope's user only, with text rendered
  by a function injected from the composition root; the budgets module never imports the notices domain.
- API → PostgreSQL: parameterized Drizzle statements cross it; the composite owner key of the marks and
  the owner column of the notices are the backstop.
- User → another user's budgets and notices: an authenticated user is not the owner of every budget;
  the owner id of the saved movement decides every read and write.
- Alert text → the user: the text is shown in the notices list and later possibly in a push message; it
  is amount-free by construction.

## STRIDE analysis
### `apps/api/src/movements/application/best-effort-expense-saved.ts`
- **Spoofing:** the hook receives the issued `AccessScope` of the saved movement from the use case and
  passes it on unchanged; no id comes from the client or the listener.
- **Tampering:** it runs after the commit and can neither change nor roll back the saved movement; a
  listener that returns garbage has no effect because the result is not read.
- **Repudiation:** every failure and every time-bound hit is logged through `reportFailure` with the
  error name, the error code and the user id, so an alert that never appeared can be traced; the error
  object itself is not logged because a driver error carries the statement and its parameters, which
  would include the budget name.
- **Information Disclosure:** log lines hold ids and error names only, never a budget name, a category,
  an amount or a threshold; a test reads the log output of a forced failure.
- **Denial of Service:** the evaluation is awaited for at most 2,000 ms and then abandoned, so a stuck
  database cannot hold the saving request; the abandoned promise gets a rejection handler, so it
  cannot crash the process as an unhandled rejection; the existing per-user write limiter already caps
  how often the hook can run.
- **Elevation of Privilege:** the hook has no scope of its own and cannot be called with another user's
  scope, because the use case passes the one it was handed.

### `apps/api/src/budgets/application/evaluate-budget-alerts.ts`
- **Spoofing:** it takes the user id from the `AccessScope` only and passes the same scope to the
  version reader, the spending reader and the store.
- **Tampering:** the month comes from the `Clock`, the stored user time zone and the movement's date,
  never from client text, and only the current month alerts, so a client cannot make it alert for a
  month it chooses by back-dating an expense; all money is `bigint` and the percentage is an integer,
  so no float rounding decides a crossing.
- **Repudiation:** it decides from stored state and is deterministic, so the same spending always
  yields the same crossings; the marks keep the record of what was published and when.
- **Information Disclosure:** it reads only the budgets that cover the category inside the owner scope;
  a budget of another user over the same category is never read and never produces a crossing.
- **Denial of Service:** the evaluation runs two aggregated statements for the budgets that cover the
  category (a user holds at most 50 budgets), never one query per budget, and it returns before any
  read when the expense is not in the current month; a benchmark holds the added time under 100 ms at
  p95.
- **Elevation of Privilege:** it cannot evaluate a budget that the scoped version reader did not return,
  and it has no way to publish a notice for a user other than the scope's user.

### `apps/api/src/budgets/infrastructure/db/drizzle-budget-alert-store.ts`
- **Spoofing:** the owner of every mark and notice is the scope's user id, never a value from the event
  or the budget row; the composite foreign key rejects a mark whose budget belongs to another owner.
- **Tampering:** marks and notices are written in one transaction with bound parameters; the unique key
  `(budget_id, month, threshold)` plus `ON CONFLICT DO NOTHING` means two concurrent movements cannot
  create two marks, and a notice is inserted only for a newly inserted mark, so a race cannot duplicate
  or forge an alert; a failed notice insert rolls the mark back.
- **Repudiation:** each notice points to its mark through `payment_id` and each mark carries its
  creation time, so every alert can be traced to the threshold and month that caused it.
- **Information Disclosure:** the store reads only the owner's own language from `users` by id and
  writes text that holds the budget name and the threshold; the name is the owner's own data and goes
  only into the owner's notice.
- **Denial of Service:** one transaction with at most one insert per crossed threshold (a budget has at
  most a handful of thresholds); an attempt that finds every mark present inserts nothing and
  publishes nothing, so repeated expenses above a threshold do not grow the tables.
- **Elevation of Privilege:** the store accepts no owner parameter; it writes only rows for the scope it
  was given, and deleting a budget cascades its marks so no mark outlives its owner's budget.

### `apps/api/src/budgets/infrastructure/db/schema.ts`
- **Spoofing:** not applicable: a schema file holds no identity or I/O; the owner column and the
  composite key tie each mark to the identity of the budget's owner.
- **Tampering:** the unique key, the threshold range check and the first-day check keep the marks
  consistent even if application code has a bug; migration 0036 is additive and its rollback is
  idempotent and deletes only the `budget_alert` notices it created.
- **Repudiation:** marks are append-only: no code path updates a mark, and they disappear only with
  their budget.
- **Information Disclosure:** the table holds ids, a month, a threshold and a timestamp, with no
  amount and no name; the notice text is stored in the existing `notices` table.
- **Denial of Service:** at most 50 budgets times a few thresholds times one row per month per user,
  served by the unique index; the migration takes a lock only on the new table and on the check of
  `notices`.
- **Elevation of Privilege:** the composite foreign key to `budgets (id, owner_id)` prevents a mark
  from pointing at another owner's budget; the check on `notices.kind` rejects any kind the system does
  not know.

### `apps/api/src/notices/domain/notice-text.ts`
- **Spoofing:** not applicable: a pure function with no identity and no I/O.
- **Tampering:** the budget name is truncated to 80 characters and placed in the text as plain text, and
  the threshold must be an integer from 1 to 200, so the text stays within the 1 to 300 characters check;
  the web list renders it as a text node, never as markup.
- **Repudiation:** the function is deterministic, and its output is stored, so the user sees exactly
  what was published.
- **Information Disclosure:** it receives no amount, no currency figure and no account name, so none
  can reach the stored text or a later push message; a test scans the output for digits other than the
  threshold and for account and category names.
- **Denial of Service:** work is linear in the name length, which is cut at 80 characters.
- **Elevation of Privilege:** not applicable: no privileged operation.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Budget alert marks (budget id, month, threshold) | PII | stored in PostgreSQL with managed encryption at rest | TLS between the API and the database only |
| Alert notice text (budget name and threshold percentage) | PII | stored in the `notices` table with managed encryption at rest | HTTPS to the browser |
| Spending and available amounts used to decide a crossing | financial | computed per evaluation and never stored by this ticket; the source rows are in PostgreSQL | TLS between the API and the database only |
| User language and time zone used for the text and the month | PII | stored in PostgreSQL by PRD 01 | TLS between the API and the database only |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A user receives an alert about another user's budget | I | Low | High | The evaluator and the store use only the `AccessScope` of the saved movement, the composite owner key rejects a foreign mark, and a flow test seeds a second user with an identical category and asserts no notice (Blocks 3 and 5) |
| R-02 | Two concurrent movements publish the same alert twice | T | Medium | Medium | A unique key on the mark and `ON CONFLICT DO NOTHING`, with the notice inserted only for a new mark in the same transaction; a concurrency test asserts exactly 1 notice (Blocks 2, 3 and 5) |
| R-03 | The evaluation slows or breaks the saving of a movement | D | Medium | High | It runs after the commit, awaited with a 2,000 ms bound, errors are logged and never raised, the work is filtered to the budgets that cover the category, and a benchmark holds p95 under 100 ms (Blocks 3, 4 and 5) |
| R-04 | An error log leaks a budget name or an amount through the driver error | I | Medium | Medium | The hook logs the error name, the error code and the user id only, never the error object; a test inspects the log output of a forced failure (Blocks 4 and 5) |
| R-05 | The alert text exposes an amount or an account name, here or in a later push message | I | Low | High | The text is rendered by the amount-free function that receives only the budget name and the threshold; a test scans the stored text (Blocks 1 and 5) |
| R-06 | A missed crossing is never alerted | R | Medium | Low | The evaluation is state-based, so the next expense in a covered category publishes every threshold with no mark; group expenses are a documented limitation (spec D5, open question 3) |
| R-07 | A back-dated or future-dated expense alerts for a month that is not the current one | T | Medium | Low | Only the current month in the user's time zone alerts; tests cover past, future and the 01:00 UTC boundary (Blocks 3 and 5) |
| R-08 | An unhandled rejection from an abandoned evaluation crashes the API | D | Low | High | A rejection handler is attached to the same promise before the race, and a fake-timer test asserts no unhandled rejection (Block 4) |
| R-09 | The migration collides with another branch or cannot be rolled back | T | Medium | Medium | Journal `when` above the maximum on `main`, renumbering at merge, an idempotent rollback tested twice, and the chain tests updated (Block 2) |

## Supply chain
No new runtime dependency: the feature reuses Drizzle, Express, Zod and the shared money, time and
notice helpers already in the project (spec D14). The only schema change is one table and a widened
check, in migration 0036.
