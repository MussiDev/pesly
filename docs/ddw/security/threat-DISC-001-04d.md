# Threat model DISC-001-04d: Session, Sign Out and Local Data

| Field | Value |
|-------|-------|
| Ticket | DISC-001-04d |
| Spec | docs/ddw/specs/spec-DISC-001-04d.md |
| Tier | FEATURE |
| Date | 2026-10-06 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/web/src/lib/local-store/wipe-marker.ts`, `apps/web/src/lib/local-store/wipe.ts`, `apps/web/src/lib/local-store/user-id.ts` and `apps/web/src/lib/local-store/database.ts` | Block 1 |
| `apps/web/src/features/shell/use-sign-out.ts` and `apps/web/src/features/shell/components/sign-out-confirmation.tsx` | Block 2 |
| `apps/web/src/features/shell/containers/authenticated-shell-container.tsx` and `apps/web/src/features/profile/containers/delete-user-container.tsx` | Block 3 |

## Trust boundaries
- Browser → API: `POST /auth/sign-out` (idempotent, 204, clears the session cookies) and `DELETE` of the account, under the session cookie and the web origin headers, over the public internet; the local wipe starts only after the API answers success.
- Page → IndexedDB: scripts of the web origin delete the whole per-user database `pesly-<userId>` that holds the queue, the reference copy and the recent movements, under the browser's per-origin isolation.
- Page → localStorage: the session pointer `pesly.session` and the wipe marker `pesly.wipe` (user ids only) are written and read by scripts of the web origin.
- Tab ↔ tab: other tabs of the origin learn of a sign out through the `storage` event and through `versionchange` on their open database connections.
- Device owner → browser profile: anyone with the unlocked device or the browser profile can read what is still on the device; after a confirmed sign out that is no account data of the user who left.
- Queue → API session: the queue is sent only under the session the API confirmed for the same user in this visit.

## STRIDE analysis
### `apps/web/src/lib/local-store/wipe-marker.ts`, `apps/web/src/lib/local-store/wipe.ts`, `apps/web/src/lib/local-store/user-id.ts` and `apps/web/src/lib/local-store/database.ts`
- **Spoofing:** a database name is built only from an id matching `USER_ID_PATTERN`, so a forged pointer or marker entry cannot name another origin's or another app's database (R-06).
- **Tampering:** the marker is parsed with a Zod schema on every read; a script of the origin that empties the marker could let a late writer recreate an empty database, which holds nothing of the user (R-06).
- **Repudiation:** a local wipe has no audit value; the API logs the sign out with request id, user id and session ids (existing route).
- **Information Disclosure:** the whole database is deleted, not store by store, so no store is left behind (R-01); an interrupted wipe leaves the pointer cleared and the marker set, so the app refuses to open that data and finishes the deletion on the next start (R-02).
- **Denial of Service:** the marker holds at most 20 ids; a blocked deletion waits for the other tab, whose connection closes on `versionchange` (R-05).
- **Elevation of Privilege:** not applicable; the wipe only removes data and grants nothing.

### `apps/web/src/features/shell/use-sign-out.ts` and `apps/web/src/features/shell/components/sign-out-confirmation.tsx`
- **Spoofing:** the count and the wipe are for the pointer's user, which online is the user the API confirmed in this visit (R-03).
- **Tampering:** the confirmation takes no free text; its count is derived from the queue on each request.
- **Repudiation:** the discarded changes never reached the server, so nothing is lost from the server's record; the user confirmed the loss explicitly (R-04).
- **Information Disclosure:** the confirmation shows only a count, never amounts, accounts or notes.
- **Denial of Service:** a failed sign out keeps the data and the session, so a network error cannot leave the user signed in with nothing on the device (R-07).
- **Elevation of Privilege:** the sign out cancels the sync retry before the API call, and after the API ends the session every send answers 401, so no change leaves under a session that is ending (R-03).

### `apps/web/src/features/shell/containers/authenticated-shell-container.tsx` and `apps/web/src/features/profile/containers/delete-user-container.tsx`
- **Spoofing:** a pass starts only for the user the API confirmed in this visit; another user's queue on the device is never opened by the pass (R-03).
- **Tampering:** only a `storage` event for `pesly.session` with a `null` value redirects; other keys or values are ignored.
- **Repudiation:** the account deletion is logged by the API as today.
- **Information Disclosure:** pending wipes are finished on start; other tabs go to sign-in when the pointer disappears; a deleted account leaves no local data (R-02, R-08).
- **Denial of Service:** a session that expires keeps the queue and the copy, so expiry offline cannot cost the user their changes (R-04).
- **Elevation of Privilege:** the marker entry is removed only after the API confirms that same user, so nobody else can reopen that user's data.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Queued changes, reference copy and recent movements in `pesly-<userId>` | financial | per-user IndexedDB database on a disk the operating system encrypts where the user has it on (decision R-04 of DISC-001-04a); deleted whole on a confirmed sign out or account deletion | stays on the device; sent over TLS when synced |
| User id in `pesly.session` and `pesly.wipe` | PII | `localStorage` of the web origin, an opaque UUID with no name or email; the pointer is cleared on sign out, the marker keeps the id until that user signs in again | never sent by this ticket |
| Session cookie on `POST /auth/sign-out` | credentials | not stored by the web; the identity module stores session tokens hashed and revokes them on sign out | TLS (production HTTPS guard), cookie flagged Secure and HttpOnly |
| Count of changes pending sync | public | derived on demand, not stored | stays on the device |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | A store of the user's data survives the sign out (a store added later, or one the code forgot) | I | Low | High | The whole database is deleted (D1), not store by store; tests assert the database list no longer has `pesly-<id>` and that a reopened database is empty (Block 1) |
| R-02 | A sign out interrupted half way (tab closed, browser killed, blocked deletion) leaves the data readable | I | Medium | High | The marker is written and the pointer cleared before the deletion; `openLocalDatabase` refuses a user in the marker; the shell finishes every pending wipe on start; tests cover the interrupted and the blocked deletion (Blocks 1, 3) |
| R-03 | One user's queue is sent under another user's session on a shared device | S | Low | High | A pass runs only for the user confirmed in this visit, each user's queue lives in their own database, the sign out cancels the retry before ending the session, and the server scopes every movement route by the session; tests cover a different user signing in (Blocks 2, 3). This closes R-06 of 04b and R-03 of 04c |
| R-04 | Changes pending sync are lost without the user knowing, on sign out or on session expiry | D | Medium | High | Sign out with pending or failed changes shows the count and needs confirmation (PRD decision of 2026-09-25 that they are lost); expiry never wipes; tests cover both (Blocks 2, 3) |
| R-05 | A deletion blocked by another tab never completes and the data stays | D | Low | Medium | Every connection closes on `versionchange` (04a), so the deletion completes when the other tab reacts; meanwhile the marker blocks reopening and the next start retries; the marker holds at most 20 ids (Block 1) |
| R-06 | A tampered pointer or marker names another database or recreates data | T | Low | Low | Ids are checked with `USER_ID_PATTERN` and the marker is parsed with Zod; a script of the origin could read IndexedDB directly anyway, so this adds no new capability (Block 1) |
| R-07 | The local data is wiped while the browser keeps a valid session (offline sign out, failed API call) | E | Medium | Medium | The wipe runs only after the API answers the sign out with success; on failure the error shows and nothing is wiped (Block 2) |
| R-08 | Another tab, or a deleted account, keeps showing or holding the user's data after the sign out | I | Medium | Medium | Other tabs go to sign-in on the pointer's removal and lose their connection on `versionchange`; the account deletion wipes like a sign out (Block 3) |
| R-09 | A user who never signs out on a shared device, or who is followed by another user without signing out, leaves their data on it | I | Medium | Medium | Accepted, see below: the data stays scoped to that user's database and is never sent or shown under another user (parent index decision 5, PRD Out of Scope) |

## Accepted risks
### R-09
- **Accepted by:** the product owner, through the PRD of DISC-001-04d (Out of Scope: wiping the data of the user who is no longer signed in when a different user signs in, and encryption of local data beyond what the browser and operating system provide), accepted with the split on 2026-10-04, and the decision R-04 of `threat-DISC-001-04a.md`.
- **Justification:** removing the data needs the user's action or their session, and a different user's sign-in is not proof that the first one left the device; the data stays in its own per-user database, is never sent under or shown to another user (R-03), and goes with that user's next confirmed sign out on the device. This review closes the condition "revisited when DISC-001-04d lands" of R-04 of 04a: with the wipe in place R-03 and R-04 of 04a, R-06 and R-07 of 04b and R-03 and R-07 of 04c are mitigated for every confirmed sign out, and only this residual case stays accepted.
- **Review conditions:** before the app supports group data on shared devices (PRD 05), if a session timeout that signs users out automatically is added, and immediately if a vulnerability lets a script of the origin read IndexedDB.

## Supply chain
No runtime dependency is added: `indexedDB.deleteDatabase`, `localStorage` and the `storage` event are platform APIs, the confirmation composes the owned `Button` component, and tests use `fake-indexeddb`, a dev dependency since DISC-001-04a. The audit (`pnpm audit --prod --audit-level high`) and the SAST step cover the change.

## Availability
The vectors are a deletion that never completes (R-05), a failed sign out that strands the user (R-07) and the loss of pending changes (R-04). The deletion completes when other tabs close on `versionchange` and is retried on every start; a failed sign out keeps both session and data; pending changes are lost only after an explicit confirmation. The API is unchanged, so no deploy order problem can arise.
