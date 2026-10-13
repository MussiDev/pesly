# Threat model FEAT-008: Link a group expense to the payer's own account

| Field | Value |
|-------|-------|
| Ticket | FEAT-008 |
| Spec | docs/ddw/specs/spec-FEAT-008.md |
| Tier | FEATURE |
| Date | 2026-10-13 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/api/src/groups/application/link-payer-movement.ts` | Block 2 |
| `apps/api/src/groups/application/list-movement-candidates.ts` | Block 2 |
| `apps/api/src/groups/infrastructure/db/drizzle-group-expense-repository.ts` | Block 2 |
| `apps/api/src/groups/infrastructure/movements/drizzle-payer-movement-recorder.ts` | Block 2 |
| `apps/web/src/features/groups/expenses/link/link-expense-container.tsx` | Block 3 |

## Trust boundaries
- Browser → Express API: the group id, the expense id, the account id, the category id and the movement
  id are chosen by the caller, and `POST /groups/:id/expenses/:expenseId/payer-movement` and
  `GET /groups/:id/expenses/:expenseId/movement-candidates` decide what they may touch.
- Group data → personal data: a group expense belongs to the group (every member can read it), while the
  account, the category and the movement belong to one user; linking joins the two.
- Application → PostgreSQL: the link writes a movement and an expense row in one transaction, between
  rows that other users' requests may be changing at the same moment.

## STRIDE analysis
### `apps/api/src/groups/application/link-payer-movement.ts`
- **Spoofing:** the user id comes from the session issued by the authentication middleware, never from
  the body, and the payer is decided by comparing the caller's member with the expense's payer member.
- **Tampering:** the body is parsed by a strict discriminated union, so an extra key or a mixed body is
  refused before the use case runs, and the movement's amount and currency are compared with the
  expense's, so a movement of another amount cannot be attached.
- **Repudiation:** the route writes the existing audit log line with ids only (request, user, group,
  expense), so who linked what can be told; the group's activity log gets no entry by the owner's
  decision (R-05).
- **Information Disclosure:** a missing and a foreign account or category answer the same
  `GROUP_PAYER_ACCOUNT_INVALID`, and a missing and a foreign movement answer the same 404, so the answers
  do not tell whether another user's record exists (R-01).
- **Denial of Service:** one expense, one account or movement and one transaction per request, with no
  loop over the group's data, behind the existing write rate limit of 60 per minute per user.
- **Elevation of Privilege:** only the payer, a registered member, can link; an admin, the creator who
  is not the payer and a member outside the group are refused with 403 or 404, so nobody can attach an
  account to an expense paid by someone else (R-02).

### `apps/api/src/groups/application/list-movement-candidates.ts`
- **Spoofing:** it takes the user id from the session and asks the recorder for that user's rows only.
- **Tampering:** it only reads; no write and no state change.
- **Repudiation:** a read leaves nothing to deny and shares the request log of the API.
- **Information Disclosure:** it returns only the payer's own unlinked expense movements of the expense's
  amount and currency, and the answer is refused with 403 to any other member, so another member cannot
  read the payer's spending (R-01).
- **Denial of Service:** the answer is capped at 20 rows and the query uses the owner and date index of
  `movements`.
- **Elevation of Privilege:** the same payer check as the link, so reading the candidates grants nothing
  that linking does not.

### `apps/api/src/groups/infrastructure/db/drizzle-group-expense-repository.ts`
- **Spoofing:** the repository receives the payer's user id from the use case and uses it as the scope of
  every movement read or write, never an id taken from the expense row.
- **Tampering:** the movement and the expense row are locked in the order of an expense change, the link
  is re-checked after the locks, and the partial unique index on `payer_movement_id` backs it up, so two
  racing requests cannot both link or attach one movement to two expenses (R-03).
- **Repudiation:** the transaction writes the movement through the movements module, which keeps its own
  created-at, and no row is written that could be removed afterwards.
- **Information Disclosure:** the 409 answers carry the error code only and no amount, id or note, as the
  send-to-group answers do.
- **Denial of Service:** the transaction holds the locks for a few statements and takes them in one fixed
  order, so it cannot deadlock with an edit or a delete of the same expense.
- **Elevation of Privilege:** it writes only the two link columns of the expense and never the shares,
  the version or the activity log, so a link cannot be used to change what the group owes.

### `apps/api/src/groups/infrastructure/movements/drizzle-payer-movement-recorder.ts`
- **Spoofing:** every lookup runs with the payer's own scope, so an account, a category or a movement of
  another user is not found.
- **Tampering:** an adopted movement keeps the existing lock that refuses a change of its amount, account
  or date with 409, so the figures the group relies on cannot drift after the link (R-04).
- **Repudiation:** a created movement goes through the movements module, which records it like any other
  expense movement of the payer.
- **Information Disclosure:** the candidate query selects the payer's rows only and returns the account
  name, never another user's data.
- **Denial of Service:** the candidate read is one query with a limit of 20 and a `not exists` against the
  unique index on `payer_movement_id`.
- **Elevation of Privilege:** it creates movements only in an account that the payer owns and that is
  open, in the expense's currency, so it cannot write into someone else's account.

### `apps/web/src/features/groups/expenses/link/link-expense-container.tsx`
- **Spoofing:** the screen sends no identity; the session cookie is the only credential, and a 401 sends
  the person to sign-in.
- **Tampering:** the screen builds the body from the person's choices and checks it with the shared
  schema, and the server validates it again and decides who may link, so editing the page changes
  nothing the server trusts.
- **Repudiation:** a static screen with one write that the server logs.
- **Information Disclosure:** it shows the candidates the server returned to the payer and keeps nothing
  in storage; it is not cached for offline use.
- **Denial of Service:** it issues one load and one submit per action and sends nothing while the device
  is offline.
- **Elevation of Privilege:** the row action is only a convenience, and the server refuses a link by
  anyone but the payer whatever the page shows.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| expense amount, currency and date | financial | stored by the API in PostgreSQL | TLS to the API; session cookie flagged Secure and HttpOnly |
| the payer's account, category and movement | financial | stored by the API in PostgreSQL, private to the user | TLS to the API |
| candidate list (amounts, dates, notes, account names) | financial | not stored by the web app, kept in component state only | TLS to the API |
| user id and member id | PII | stored by the API in PostgreSQL; never taken from the request body | TLS to the API |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A caller learns whether another user's account, category or movement exists, or reads the payer's spending, through the link or the candidates | I | M | H | the same 400 for a missing and a foreign account or category, the same 404 for a missing and a foreign movement, every lookup scoped by the payer's user id, the candidates refused to non-payers, and tests with another user's records (AC-31, AC-19) |
| R-02 | A member who is not the payer attaches an account or a movement to someone else's expense | E | M | H | the use case compares the caller's member with the expense's payer member and refuses a ghost payer with 403, before any lookup, with tests for another member, an admin and a ghost (AC-03, AC-04) |
| R-03 | Two requests link the same expense, or one movement to two expenses, and the account is debited twice or the movement is shared | T | M | H | one transaction with the group, movement, expense row and member locks in a fixed order, a re-check after the locks, the unique index on `payer_movement_id`, and a test with 20 simultaneous requests (AC-28) |
| R-04 | An adopted movement is edited after the link so that it no longer matches the expense | T | L | M | the adopted movement is locked against a change of amount, account or date by the existing rule, with a test (AC-16), and the amount and currency are compared again under the lock |
| R-05 | The link leaves no trace in the group's activity log, so the other members cannot see that a member linked an account | R | L | L | accepted, see below; the request log keeps who linked what with ids only |
| R-06 | The candidate query or the link degrades the service with a large group | D | L | M | the candidates are capped at 20 with an indexed query, one transaction per link, the existing write rate limit, and a latency test with 10,000 expenses (AC-29) |

## Accepted risks
### R-05
- **Accepted by:** the owner of the product, in the decision of 2026-10-13 recorded in the PRD decision log
- **Justification:** the link changes no shared figure (amount, payer, shares), the account is the payer's
  private bookkeeping, and an activity entry would show the other members something they cannot use and
  would add a new log action to maintain in two languages.
- **Review conditions:** revisited if the group log is ever used as an audit trail of who may change
  what, or if members ask to see that an expense was settled against an account.

## Supply chain
No new dependency: the change uses Drizzle, Zod, Express and the shared helpers already in `apps/api`,
and React and next-intl already in `apps/web`. AGENTS.md requires a justification for any new runtime
dependency, and there is none to justify.

## Availability
A link is one short transaction and a candidate read is one capped query; neither runs in the background.
If the transaction fails, nothing is written and the request answers an error that the screen shows with
a retry, and the other screens of the app are unaffected. The API stays stateless: no cache and no
process memory is added.
