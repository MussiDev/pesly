# Threat model DISC-001-03e: Edit and Delete Movements

| Field | Value |
|-------|-------|
| Ticket | DISC-001-03e |
| Spec | docs/ddw/specs/spec-DISC-001-03e.md |
| Tier | FEATURE |
| Date | 2026-10-04 |

## Components
| Component | Source in the spec |
|---|---|
| `packages/shared/src/movements/movement.ts` and `packages/shared/src/errors.ts` | Block 1 |
| `apps/api/src/movements/application/build-new-movement.ts` and `apps/api/src/movements/application/create-movement.ts` | Block 2 |
| `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts` | Block 3 |
| `apps/api/src/movements/application/update-movement.ts` and `apps/api/src/movements/application/delete-movement.ts` | Block 4 |
| `apps/api/src/movements/infrastructure/http/movement-routes.ts` and `apps/api/src/shared/http/error-handler.ts` | Block 5 |
| `apps/web/src/lib/api-client.ts` and `apps/web/src/features/movements/movement-request.ts` | Block 6 |
| `apps/web/src/features/movements/containers/edit-movement-container.tsx` and `apps/web/src/features/movements/components/movement-form.tsx` | Block 7 |
| `apps/web/src/features/movements/containers/movements-container.tsx` and `apps/web/src/features/movements/components/movement-row.tsx` | Block 8 |
| `README.md` | Block 10 |

## Trust boundaries
- Browser → API: `PUT /movements/:id` carries the edited amount, date, note, tags and rate, and `DELETE /movements/:id` carries a movement id, over the public internet, as untrusted values behind the session cookie, the origin guard and the `X-Requested-With` header.
- API routes → use cases: validated, typed values and the access scope built from the session cross from the Express layer into the application layer; nothing else does.
- Application → PostgreSQL: owner-scoped statements with bound parameters cross into the private database network, where the composite foreign keys and the check constraints are the last line of defense.
- URL → web container: the movement id in `/movements/<id>/edit` is untrusted input to the edit container and can be typed or shared by the user.
- Repository → readers of `README.md`: the file is public and crosses from the private codebase to anyone who reads the repository.

## STRIDE analysis
### `packages/shared/src/movements/movement.ts` and `packages/shared/src/errors.ts`
- **Spoofing:** the edit contract holds no identity; the owner is never read from the body, only from the session scope, and `ownerId`, `id` and `createdAt` are not fields of it.
- **Tampering:** the same field validators as creation (strict integer strings, UTC instants, NFC-normalized notes and tags without control or format characters) and unknown keys are stripped, so a client cannot smuggle columns into an edit.
- **Repudiation:** not applicable to a contract; the routes log ids only (see the routes below).
- **Information Disclosure:** a contract failure names the field path and never echoes the amount, the note or a tag.
- **Denial of Service:** at most 10 tags of at most 30 code points, a note of at most 500 code points and amounts bounded to 10^15 limit the work a request can ask for; the JSON body limit of the app stays in force.
- **Elevation of Privilege:** the `keep` rate source can only keep what is already stored for that movement; no field widens the owner scope.

### `apps/api/src/movements/application/build-new-movement.ts` and `apps/api/src/movements/application/create-movement.ts`
- **Spoofing:** the builder takes the scope issued by the access policy and never an owner id from the request.
- **Tampering:** one builder serves creation and edition, so an edit cannot skip a creation rule (kind of category, same currency, implied rate range, future date); the edit-only allowance for an unchanged archived reference is covered by a test that moving to an archived one still fails.
- **Repudiation:** failures propagate typed domain errors to the error middleware, which logs the request id and code without values.
- **Information Disclosure:** an account or category that is missing or owned by another user raises the same not found as any missing id, so the builder confirms nothing about other users' data.
- **Denial of Service:** the builder reads at most two accounts, one category and one stored rate, and calls no external service in the request path.
- **Elevation of Privilege:** a movement can never be pointed at another user's account or category: the lookups are scoped and the composite foreign keys repeat the check in the database.

### `apps/api/src/movements/infrastructure/db/drizzle-movement-repository.ts`
- **Spoofing:** every statement of `update` and `delete` takes the owner from the scope through `scopedTo`, in the same statement that matches the id, and the tag-link delete is filtered by owner as well.
- **Tampering:** values reach the database only as bound parameters; the update, the removal of the old tag links and the new links run in one transaction, so a partial edit rolls back; amounts stay `bigint` and rates scaled integers.
- **Repudiation:** the use case logs the movement id for an edit and a delete, so the trail exists without amounts, notes or tag names; there is no history of previous values (R-05).
- **Information Disclosure:** a movement of another owner matches no row, so `update` returns `null` and `delete` returns `false`, the same as a missing id, and the route answers 404 for both (R-01, R-02).
- **Denial of Service:** each operation is one single-row statement by primary key plus at most 10 tag links, with no scan; the performance test measures p95 under 300 ms (R-07).
- **Elevation of Privilege:** the `type = data.type` condition in the update keeps an edit from turning an expense into another shape, and the check constraints reject an inconsistent row even if the application were bypassed.

### `apps/api/src/movements/application/update-movement.ts` and `apps/api/src/movements/application/delete-movement.ts`
- **Spoofing:** both take the scope built by the access policy from the session and an id validated as a UUID by the route.
- **Tampering:** the future date is refused before any write, the type is compared with the stored one, and the write is atomic; the frozen rate changes only when the user edits the rate (spec D3).
- **Repudiation:** both failures and successes pass through the request logging with the request id; the success log carries ids only.
- **Information Disclosure:** the movement is loaded inside the caller's scope before the type check, so a foreign movement answers 404 and never 409, and the existence of other users' movements is not revealed (R-02).
- **Denial of Service:** neither use case loops, fans out or calls an external service; they are not behind the creation limiter because they create no rows (R-07).
- **Elevation of Privilege:** neither use case accepts an owner or a scope from the caller's data; a movement that vanished between the read and the write is a 404, not a path to another row.

### `apps/api/src/movements/infrastructure/http/movement-routes.ts` and `apps/api/src/shared/http/error-handler.ts`
- **Spoofing:** both routes sit behind `requireSession` and `requireVerifiedEmail`, and the state-changing methods also pass the origin guard (web origin and `X-Requested-With`) on top of SameSite=Strict cookies, so a cross-site page cannot forge an edit or a delete (R-06).
- **Tampering:** params and body are validated by the shared contract through the single `validate` middleware before any handler runs; no route reads `req.body` unvalidated.
- **Repudiation:** the error middleware logs method, route, status, code and request id for every rejected request, and the routes log the movement id for every success.
- **Information Disclosure:** the 404 body is identical for a missing movement and another user's movement, error bodies carry only a code, and the 500 body is generic; logs never contain the amount, the note, the rate or a tag (R-08).
- **Denial of Service:** the JSON body limit applies, a malformed id or body is refused before the database, and each valid request is one bounded transaction (R-07).
- **Elevation of Privilege:** the write scope is issued per request by the access policy; groups are denied by the default reader, so a movement shared through a group is not editable here (PRD 05 owns that).

### `apps/web/src/lib/api-client.ts` and `apps/web/src/features/movements/movement-request.ts`
- **Spoofing:** the client sends the session cookie and the `X-Requested-With` header like the other calls and holds no identity of its own.
- **Tampering:** the request builder validates on the client first, but the API validates again; nothing on the client is trusted by the server.
- **Repudiation:** not applicable on the client; the server keeps the log.
- **Information Disclosure:** an API error is mapped to a message key, so a server detail or another user's data never reaches the screen text.
- **Denial of Service:** nothing is sent while a field is invalid, and a failed call is not retried automatically.
- **Elevation of Privilege:** the builder never builds a `rate` the user did not touch, and the server never trusts the client's choice of owner because the body has none.

### `apps/web/src/features/movements/containers/edit-movement-container.tsx` and `apps/web/src/features/movements/components/movement-form.tsx`
- **Spoofing:** the screen reads the movement through the API with the user's session; a typed id of another user's movement answers 404 and the not-found state shows.
- **Tampering:** the type is locked in the form and the id comes from the address bar only to ask the API; the saved values pass the client builder and the API contract.
- **Repudiation:** not applicable; the server logs the edit with the movement id.
- **Information Disclosure:** the not-found state is the same for a missing and a foreign movement, and the note and tags render as React text, never as HTML, with the content security policy of the web app in force (R-10).
- **Denial of Service:** one `getMovement` and the usual form data per visit, with no polling.
- **Elevation of Privilege:** the form cannot change the owner, and it offers an archived account or category only when the movement already uses it (spec D4).

### `apps/web/src/features/movements/containers/movements-container.tsx` and `apps/web/src/features/movements/components/movement-row.tsx`
- **Spoofing:** the delete call uses the session cookie and the ids of the loaded list, which the API already scoped to the user.
- **Tampering:** a delete needs a deliberate second click on the inline confirmation, so a stray click cannot remove a movement (R-12).
- **Repudiation:** the server logs each delete with the movement id; there is no undo, which the PRD puts out of scope.
- **Information Disclosure:** the confirmation and the buttons have accessible names that do not include the amount, so a screen reader or a shared screen does not read it out loud.
- **Denial of Service:** a delete reloads the list once and a stale answer for older filters is discarded, as already done for filters.
- **Elevation of Privilege:** the row offers the actions only for items the API returned, so the list cannot be used to reach another user's movement.

### `README.md`
- **Spoofing:** the README shows the repository URL of the project; it must name the real repository and nothing that imitates another.
- **Tampering:** the file is versioned and reviewed in the pull request like any other change; the README test fails when it names a script or path that does not exist.
- **Repudiation:** the change is attributable through git history.
- **Information Disclosure:** the README holds no secret, credential or private address; it only names `.env.example` as the template for local configuration and never copies a value from it.
- **Denial of Service:** not applicable to a text file.
- **Elevation of Privilege:** the README runs nothing; the commands it lists are for a developer to run knowingly on their own machine.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Movement note and tag names (free text chosen by the user, now editable) | PII | PostgreSQL volume encrypted at rest; unchanged storage, reachable only through the owner-scoped repositories; never logged | TLS (production HTTPS guard) |
| Movement amount, destination amount, date, account and category ids, frozen rate | financial | PostgreSQL volume encrypted at rest; unchanged by this ticket, integers only | TLS |
| Tag-to-movement links | financial | PostgreSQL volume encrypted at rest; composite foreign keys keep them under one owner; removed and recreated on edit | private database network |
| Session cookie presented to the routes | credentials | not stored by this module; the identity module stores it hashed | TLS, cookies flagged Secure in production |
| README content | public | versioned in git, contains no secret | not applicable |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A caller edits or deletes a movement of another owner through a forged or guessed id | E | Medium | High | Owner predicate through `scopedTo` in the same statement as the id match in both `update` and `delete`, composite foreign keys, and tests with a second user for both routes (Blocks 3, 5) |
| R-02 | The response to an edit reveals that another user's movement exists (404 versus 409 or 400 for the same id) | I | Medium | Medium | The movement is loaded in scope before the type check and before any validation that depends on it, so a foreign id always answers 404 with the same body as a random UUID, and a test compares the bodies (Blocks 4, 5) |
| R-03 | A client sends `ownerId`, `id`, `createdAt` or another column in the edit body (mass assignment) | T | Medium | High | Unknown keys are stripped by the contract and the repository picks fields one by one, so no extra column can be written (Blocks 1, 3) |
| R-04 | An edit leaves a balance wrong: a move between accounts, a half-written update or a lost tag link | T | Medium | High | Balances are summed on read, so there is nothing stored to desynchronize; the update and its tag links run in one transaction; tests recompute both accounts for every type (Blocks 3, 5) |
| R-05 | Editing leaves no audit trail, so a changed amount or rate cannot be reconstructed or disputed | R | Medium | Medium | Accepted risk, see below; the request log keeps who changed which movement id and when (Block 5) |
| R-06 | A malicious page triggers an edit or a delete in the user's session (CSRF) | S | Low | High | SameSite=Strict Secure cookies, and the origin guard that requires the web origin and `X-Requested-With: argent` on every non-safe method, which includes `PUT` and `DELETE`; a route test sends both without the header and expects 403 (Block 5) |
| R-07 | A user floods the edit or delete routes to load the database | D | Low | Low | No new rows are created and each request is one single-row statement by primary key plus at most 10 links; the JSON body limit and strict contract stop large bodies before the database; a p95 test under 300 ms guards the cost (Blocks 3, 9) |
| R-08 | Amounts, notes, rates or tags leak into logs or error bodies on an edit or a delete | I | Medium | Medium | Routes log ids only, contract errors name paths and never values, the 500 body is generic, and a test inspects the log and the body (Block 5) |
| R-09 | SQL injection through an edited note, tag, id or rate | T | Low | Critical | Strict shared contract (UUIDs, integer strings, real dates, enums) and bound parameters only; the raw SQL of the tag link keeps its bound values (Blocks 1, 3) |
| R-10 | An edited note or tag holding markup runs as script in the list or the form | T | Low | High | Notes and tags render as React text, control and format characters are rejected by the contract, and the content security policy of the web app stays in force (Blocks 1, 7) |
| R-11 | A concurrent delete or account removal during an edit produces a 500 or a half-written movement | T | Low | Medium | The write is one transaction conditioned on id, owner and type, a `null` result is a 404, and a key violation of a vanished account or category is mapped to not found (Blocks 3, 4) |
| R-12 | A user deletes a movement by mistake and cannot recover it | T | Medium | Low | A two-step inline confirmation with a cancel before the call; undo is out of scope in the PRD and listed there as such (Block 8) |
| R-13 | The README exposes a secret, an internal address or a command that points at something that does not exist | I | Low | Low | The README names only `.env.example`, never its values, and the README test checks every script and path against the repository (Block 10) |

## Accepted risks
### R-05
- **Accepted by:** the product owner, as the user decision recorded in the Decision Log of `docs/ddw/prd/prd-DISC-001-03e.md` on 2026-09-25 ("free editing without an audit trail").
- **Justification:** the PRD explicitly puts an audit trail out of scope; the movements are personal data of one owner, the request log already records the editor and the movement id, and previous values are not needed for a personal budget.
- **Review conditions:** revisited when groups edit shared movements (PRD 05), where an edit by one member changes what others owe, or earlier if a dispute about a changed amount is reported.

## Supply chain
There are no new runtime dependencies: the work uses Zod, Drizzle, Express, React and next-intl, which the project already has. No external service is called, and the README adds no code that runs.

## Availability
The vectors are repeated edits and deletes, covered by R-07 and R-11: one single-row transaction per request, a body limit, a strict contract and a measured p95 under 300 ms. The ticket adds no migration, so a failed deploy cannot leave the database in a new shape, and reverting the commits restores the previous behavior without touching any stored movement.
