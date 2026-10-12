# Threat model DISC-001-05j: Group Category Views

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05j |
| Spec | docs/ddw/specs/spec-DISC-001-05j.md |
| Tier | FEATURE |
| Date | 2026-10-12 |

## Components
| Component | Source in the spec |
|---|---|
| `packages/shared/src/groups/expense-summary.ts` | Block 1 (and the filter keys added to `expense.ts`) |
| `apps/api/src/groups/application/list-group-expenses.ts` | Block 2 (and `listExpenses` of the Drizzle expense repository) |
| `apps/api/src/groups/application/summarize-group-expenses.ts` | Block 3 (with the summary reader adapter and the `GET /groups/:id/expenses/summary` route) |
| `apps/web/src/lib/api-client.ts` | Block 4 (`listGroupExpenses` filters, `getGroupExpenseSummary`) |
| `apps/web/src/features/groups/category-views/summary-view.ts` | Block 5 (with `resolve-category.ts`, `months.ts`, `format.ts`) |
| `apps/web/src/features/groups/category-views/components/category-summary.tsx` | Block 6 (with the chip, filter, month picker and active chips) |
| `apps/web/src/features/groups/expenses/list/group-expenses-container.tsx` | Block 7 (with the row and list components) |
| `apps/web/src/features/groups/category-views/summary-container.tsx` | Block 8 |
| `apps/web/src/features/groups/category-views/group-expenses-page.tsx` | Block 9 |
| `apps/web/src/features/groups/expenses/edit/expense-edit-view.tsx` | Block 10 (category chip) |

## Trust boundaries
- Browser → API list and summary: `GET /groups/:id/expenses?categoryIds&from&to` and
  `GET /groups/:id/expenses/summary?from&to` carry a group id in the path and category ids and instants in the
  query over the public internet; the API validates all of them, checks membership and answers 404 to
  anything the caller may not see.
- API → PostgreSQL: the filter and the aggregate cross into the database as parameterized values; the
  adapter scopes every statement by `group_id`.
- Other members → this user's page: category names, expense descriptions and member names are written by
  other members and are rendered in chips, rows and summary lines; they are untrusted text.
- Browser UI → component state: the month and the selected category ids live only in memory and are built
  from the picker's own options and the loaded categories; no URL parameter or storage feeds them.
- Money values → display: totals cross from `bigint` strings on the wire to formatted text; they must not
  pass through a float on the way.

## STRIDE analysis
### `packages/shared/src/groups/expense-summary.ts`
- **Spoofing:** not applicable; the schemas carry no identity, the caller is the session cookie.
- **Tampering:** a strict object with typed fields: a non-UUID id, a repeated id, more than 50 ids, a reversed
  range or a span above 366 days is refused before any read (R-02, R-05).
- **Repudiation:** not applicable; pure validation with no I/O.
- **Information Disclosure:** the response schema accepts only string sums, counts and the category fields the
  group already shows; it has no member, payer or description field, so the summary cannot leak them.
- **Denial of Service:** the id list is capped at 50 entries and 1,850 characters, and the range at 366 days,
  so one request cannot ask for an unbounded read (R-05).
- **Elevation of Privilege:** not applicable; the schemas grant nothing.

### `apps/api/src/groups/application/list-group-expenses.ts`
- **Spoofing:** the caller is the session user; the use case calls `GroupAccess.member` before the read.
- **Tampering:** read-only; the category ids and the instants are bound parameters (`inArray`, `>=`, `<=`),
  never concatenated into SQL, so a crafted id cannot change the statement (R-02).
- **Repudiation:** reads are not logged in the activity log; the request log carries ids only.
- **Information Disclosure:** every statement keeps `group_id = $1`, so a category id of another group matches
  nothing and a non-member, an unknown group and a stranger's id all answer 404, never 403 (R-01).
- **Denial of Service:** the filter conditions use the `(group_id, occurred_at, id)` index and the page
  stays at most 100 rows with the keyset cursor; the filter adds no extra query (R-05).
- **Elevation of Privilege:** any member may read the list, as before; the filter widens no access.

### `apps/api/src/groups/application/summarize-group-expenses.ts`
- **Spoofing:** the route sits behind the session and verified-email checks and the use case checks
  membership first.
- **Tampering:** read-only; the sums come from `sum(amount)` in PostgreSQL `numeric` converted with `BigInt`,
  and the currency total is the `bigint` sum of its lines, so the response cannot disagree with itself or
  overflow (R-03, R-06).
- **Repudiation:** reads are not written to the activity log; the summary is recomputed from the table on
  every request, so it can never be a stale record that someone disputes.
- **Information Disclosure:** the query is scoped by `group_id` and by the caller's membership; a non-member
  and an unknown group answer the same 404; the answer holds sums, counts and category fields only, no
  description, member or payer (R-01, R-04).
- **Denial of Service:** one aggregate over an indexed range of at most 366 days, benchmarked below 300 ms at
  p95 with 5,000 expenses, under the existing rate limiting (R-05).
- **Elevation of Privilege:** any member may read, as for the list (PRD 05); nothing in the route writes or
  grants access.

### `apps/web/src/lib/api-client.ts`
- **Spoofing:** the identity is the session cookie; the client sends no member id as a claim.
- **Tampering:** the query is checked with the shared schemas before sending and built with
  `URLSearchParams`; the answer is parsed with `groupExpenseSummaryResponseSchema`, so a malformed body is a
  generic failure and never partial data (R-02).
- **Repudiation:** not applicable on the client; it keeps no record of its own.
- **Information Disclosure:** failures expose only message keys, never API text; ids, ranges and totals are
  not written to the console or any client log.
- **Denial of Service:** one request per user action, no polling and no retry loop; a 401 triggers the
  existing single serialized refresh (R-05).
- **Elevation of Privilege:** the client never decides who may read; a group the caller is not in answers 404
  and is shown as not found (R-01).

### `apps/web/src/features/groups/category-views/summary-view.ts`
- **Spoofing:** not applicable; pure functions with no identity.
- **Tampering:** shares are `bigint` basis points and only `formatShare` converts a basis-point number for
  display; a property test over 1,000 random sets and a source scan keep any total, amount or count out of a
  float (R-03).
- **Repudiation:** not applicable; no I/O.
- **Information Disclosure:** an id missing from the categories resolves to the neutral copy and never to a
  raw id; nothing is logged.
- **Denial of Service:** work is linear in the number of summary lines (at most two currencies and the
  group's categories) and the month list is a fixed 121 entries.
- **Elevation of Privilege:** not applicable; the modules read data and grant nothing.

### `apps/web/src/features/groups/category-views/components/category-summary.tsx`
- **Spoofing:** not applicable; presentational components with no identity.
- **Tampering:** category names are written by other members and rendered only as React text with wrapping,
  never with `dangerouslySetInnerHTML`; a test renders an `onerror` payload as literal characters (R-04).
- **Repudiation:** not applicable; the components record nothing.
- **Information Disclosure:** the components show only what their props hold: category, amount, percentage;
  they have no member or description field in the summary.
- **Denial of Service:** the lists are bounded by the group's categories; a bar is one element with a width.
- **Elevation of Privilege:** not applicable; the toggles only change local state.

### `apps/web/src/features/groups/expenses/list/group-expenses-container.tsx`
- **Spoofing:** `selfMemberId` and the role still come from the group and options answers, not from storage
  or the URL.
- **Tampering:** rows come from the API validated by the shared schemas; a late answer of an earlier filter is
  dropped by the generation guard, so a stale page cannot replace the current one (R-07).
- **Repudiation:** the 05h markers still show waiting and failed changes; the filter changes none of that.
- **Information Disclosure:** a non-member gets 404 and the not-found state with no hint that the group
  exists; the filtered total shown comes from the same group-scoped summary (R-01).
- **Denial of Service:** the first load keeps its 3 requests and a filter change makes 1, asserted by tests;
  "load more" is one request per click and keeps loaded rows on failure (R-05).
- **Elevation of Privilege:** the 05h edit and delete actions keep their author-or-admin rule, and the API
  stays the authority; this ticket adds no write.

### `apps/web/src/features/groups/category-views/summary-container.tsx`
- **Spoofing:** the group id is a claim the API checks against membership; the screen validates its shape with
  `isGroupId` first.
- **Tampering:** an answer for an older month arriving late is dropped, so the totals on screen always belong
  to the month selected (R-07).
- **Repudiation:** not applicable; the section is read-only.
- **Information Disclosure:** a 404 shows not-found with no hint of the group; the section requests nothing
  but the summary and shows sums per category (R-01, R-04).
- **Denial of Service:** 1 request on load and 1 per month change; a failure shows an error with a manual
  retry and starts no loop (R-05).
- **Elevation of Privilege:** read access for every member is by design; the section grants nothing.

### `apps/web/src/features/groups/category-views/group-expenses-page.tsx`
- **Spoofing:** not applicable; the page holds no identity and passes the group id on.
- **Tampering:** the month comes only from the picker's own offered options and the category ids only from
  loaded categories and summary lines, so no free text becomes a query value (R-02).
- **Repudiation:** not applicable; no record is written.
- **Information Disclosure:** state lives in memory only and is dropped when the group changes; nothing is
  written to the URL or to browser storage.
- **Denial of Service:** a month or filter change triggers one list request and one summary request, with no
  timer or polling (R-05).
- **Elevation of Privilege:** not applicable; the page composes read-only sections.

### `apps/web/src/features/groups/expenses/edit/expense-edit-view.tsx`
- **Spoofing:** not applicable; the view receives its data from the 05h container.
- **Tampering:** the chip is read-only and the category select keeps the 05h rules, so the view cannot
  change what is sent; a hand-made value is refused by the strict request schema and the API.
- **Repudiation:** the 05h activity log still attributes the edit; the chip records nothing.
- **Information Disclosure:** the chip shows the category name already available to every member; an unknown
  id shows the neutral fallback, never a raw id.
- **Denial of Service:** the screen adds no request and keeps its 3.
- **Elevation of Privilege:** the not-allowed state of 05h is unchanged and the API remains the authority.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Expense amounts, currencies and the per-category sums and counts of a group | financial | PostgreSQL, managed encryption at rest; the summary is computed per request and nothing new is stored, in the browser or the server | HTTPS only, sent with the session cookie |
| Category names, icons and colors of a group, and expense descriptions | public | PostgreSQL, managed encryption at rest; visible to every member of the group by design; never stored in the browser by this ticket | HTTPS only |
| Selected month and category filter | public | In memory of the page only; dropped on navigation; never written to the URL or storage | not sent beyond the request that uses it |
| Session cookie that authorises every call | credentials | HttpOnly cookie, never readable by page code | HTTPS only, sent with `credentials: include` |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A user edits the group id or a category id in a request to read another group's expenses or totals (IDOR) | I | Medium | High | Every statement is scoped by `group_id` and the use cases call `GroupAccess.member` first; a non-member, an unknown group and another group's category answer 404 or an empty result, never 403; integration tests cover the list filter and the summary (Blocks 2, 3, 8, 9) |
| R-02 | A crafted `categoryIds`, `from` or `to` injects SQL or breaks the statement | T | Low | High | Strict shared schemas validate UUIDs, instants and ranges before the use case, and the adapter binds every value as a parameter; a test sends invalid ids, a reversed range and a 367-day range and expects 400 with no read (Blocks 1, 2, 3, 4) |
| R-03 | Floating point or integer overflow corrupts a total or a percentage, or ARS and USD are added together | T | Medium | High | Sums are `numeric` in PostgreSQL converted to `bigint`, sent as strings, summed per currency only; shares are `bigint` basis points; a property test over 1,000 random sets and a source scan for `parseFloat`, `toFixed` and `Number(` on money (Blocks 3, 5, 11) |
| R-04 | Markup or script in a category name or description written by another member runs in a member's page | T | Medium | High | Every name is rendered as React text with no `dangerouslySetInnerHTML` and no markdown; a test renders an `onerror` payload as literal text and a scan checks the new folders (Blocks 6, 11) |
| R-05 | A wide filter, a repeated month change or a large group makes the aggregate or the list a load vector | D | Medium | Medium | The id list is capped at 50 and the range at 366 days; both reads use the group and date index; the summary has a 300 ms p95 benchmark with 5,000 expenses; one request per user action with no polling, asserted by call-count tests (Blocks 1, 3, 7, 8, 9) |
| R-06 | The summary disagrees with the expenses after an edit or delete, misleading a dispute | T | Low | Medium | No cache: each request reads the table; the lines are summed into the currency total in `bigint`; a test edits and deletes an expense and expects the next summary to change (Block 3) |
| R-07 | A late answer of a previous month or filter replaces the current one and shows wrong totals | T | Medium | Low | A generation guard in the list and a stale-answer drop in the summary; tests deliver the older answer last and expect it dropped (Blocks 7, 8) |
| R-08 | Color is the only signal for a category or a bar, hiding information from some members | I | Medium | Low | Icon, name and text amounts and percentages always accompany the color; tokens only; accessibility and design-system scans (Blocks 6, 11) |
| R-09 | A hardcoded or one-language string or a mis-formatted amount ships | T | Medium | Low | Catalog parity test, the no-literal scan over `src/features/groups` and the locale formatters (Blocks 6, 7, 8, 9, 11) |

## Supply chain
No new runtime dependency (spec D12): the screens use React, next-intl, the existing design-system components,
the shared package, the existing api-client and `Intl`; the API uses the existing Express, Zod and Drizzle.
No external service is called from these screens or this route, and no category or amount is sent to a third
party. No migration is added.

## Availability
The two reads are one indexed list query and one indexed aggregate, scoped by group and bounded by a range of at
most 366 days and at most 50 category ids; the summary has a 300 ms p95 benchmark with 5,000 expenses. The web
adds no polling, timer or retry loop: the first page load makes 3 list requests and 1 summary request, a month or
filter change makes 1 list and 1 summary request, and a failed request shows an error with a manual retry while
the other section keeps working. The summary and the filters are online only (PRD decision), so a dropped
connection shows the error state and loses nothing; the 05h device queue is untouched.
