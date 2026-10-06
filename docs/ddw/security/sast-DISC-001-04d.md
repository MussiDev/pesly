# SAST report DISC-001-04d: Session, Sign Out and Local Data

| Field | Value |
|---|---|
| Ticket | DISC-001-04d |
| Tier | FEATURE |
| Date | 2026-10-06 |
| Scope | `git diff origin/main...HEAD` over `apps/` and `packages/` without tests and e2e (12 source files, all in `apps/web/src`): `lib/local-store/{user-id,wipe-marker,wipe,database,session-pointer}.ts`, `features/shell/use-sign-out.ts`, `features/shell/components/{sign-out-confirmation,authenticated-shell,more-menu}.tsx`, `features/shell/containers/{authenticated-shell-container,more-container}.tsx`, `features/profile/containers/delete-user-container.tsx`; plus the i18n catalogs `apps/web/messages/{en,es}.json` and the e2e spec `apps/web/e2e/offline-sign-out.spec.ts` for secrets and sinks. No file under `apps/api` or `packages` changes |
| Method | Manual review of the diff by the orchestrator against catalog §4, targeted searches over the changed files (secret patterns, `innerHTML`/`dangerouslySetInnerHTML`, `eval`/`new Function`/`child_process`, `console`, outbound calls, `localStorage` use), the threat model R-01 to R-09 as checklist, plus `pnpm audit --prod --audit-level high` on the final tree after merging `origin/main` (`21ccf19`) |
| Result | PASSED — 0 Critical, 0 High, 0 Medium open; 2 Info documented below |

## Findings by rule

- ✅ F-SAST-01 Hardcoded secrets (CWE-798): the secret-pattern search over the changed files matches only catalog labels such as `password` in `apps/web/messages/en.json`; the new code stores user ids only, never a credential, and `.env*` is in `.gitignore` (line 12).
- ✅ F-SAST-02 SQL injection (CWE-89): no SQL in the scope; the API is unchanged.
- ✅ F-SAST-03 OS command injection (CWE-78): no `child_process`, `exec` or `spawn` in the scope.
- ✅ F-SAST-04 Insecure deserialization (CWE-502): the wipe marker is parsed with a Zod schema and each entry is checked again before use (`apps/web/src/lib/local-store/wipe-marker.ts:21`, `:25`); text that is not JSON or does not parse reads as an empty marker (`apps/web/src/lib/local-store/wipe-marker.ts:29`).
- ✅ F-SAST-05 Path traversal (CWE-22): no file access; a database name is built only from an id matching `USER_ID_PATTERN` (`apps/web/src/lib/local-store/database.ts:34`), so a forged pointer or marker cannot name another database (threat R-06).
- ✅ F-SAST-06 XSS (CWE-79): the confirmation renders catalog text and a number through React (`apps/web/src/features/shell/components/sign-out-confirmation.tsx`); no `innerHTML` or `dangerouslySetInnerHTML` in the scope.
- ✅ F-SAST-07 SSRF (CWE-918): no new outbound request; the sign out calls the application's own `POST /auth/sign-out` through its client (`apps/web/src/features/shell/use-sign-out.ts:29`).
- ✅ F-SAST-08 Broken cryptography (CWE-327): no randomness, hashing or encryption added.
- ✅ F-SAST-09 Debug mode in production (CWE-489): no debug flag added and no `console` call in the scope.
- ✅ F-SAST-10 Logging sensitive data (CWE-532): nothing is logged by the new code; the API's sign-out log is unchanged.
- ✅ F-SAST-11 Unrestricted upload (CWE-434): no upload surface.
- ✅ F-SAST-12 Missing CSRF protection (CWE-352): no new route; `POST /auth/sign-out` and `POST /profile/delete` keep their existing origin and session guards, and the client sends them as before.
- ✅ F-SAST-13 Critical/High CVE in a dependency: `pnpm audit --prod --audit-level high` on the final tree — "No known vulnerabilities found". Before the merge of `origin/main` it reported one high, `sharp` < 0.35.5 (GHSA-wq5f-xc86-pv6w) via `next`, present on `main` and not introduced by this ticket; `main` fixed it with the override `sharp: ^0.35.5` (PR #33), merged here in `21ccf19`.
- ✅ F-SAST-14 Incomplete input validation (CWE-20): every user id is checked with `USER_ID_PATTERN` before it touches the marker or names a database (`apps/web/src/lib/local-store/wipe-marker.ts:46`, `:53`; `apps/web/src/lib/local-store/database.ts:34`); the `storage` listener acts only on the key `pesly.session` with a `null` value (`apps/web/src/features/shell/containers/authenticated-shell-container.tsx:57`).
- ✅ F-SAST-15 Insecure error handling (CWE-209): every storage or IndexedDB failure becomes a defined result (`unavailable`, an empty marker, zero counts) with a comment saying why (`apps/web/src/lib/local-store/wipe.ts:19`, `:45`); a failed sign out shows the catalog message of the API error and keeps the data (`apps/web/src/features/shell/use-sign-out.ts:37-39`).
- ✅ F-SAST-16 Medium CVE in a dependency: none (`pnpm audit` clean after the merge; this ticket changes no manifest or lockfile).
- ✅ F-SAST-17 Unsafe function (CWE-95): no `eval`, `new Function` or `exec` in the scope.
- ✅ F-SAST-18 Suppressions complete: no suppressions in this report.
- ✅ F-SAST-19 Suppressions within review window: no suppressions in this report.

## Cross-cutting checks

- Wipe on sign out: the local data is deleted only after the API answers the sign out with success (`apps/web/src/features/shell/use-sign-out.ts:29-33`), the whole per-user database goes in one `deleteDatabase` (`apps/web/src/lib/local-store/wipe.ts:18`), and the marker blocks reopening it while it is pending (`apps/web/src/lib/local-store/database.ts:43`; threats R-01, R-02, R-07).
- Wrong-user sends: the sync retry is cancelled before the sign-out request (`apps/web/src/features/shell/use-sign-out.ts:28`) and before the account deletion's wipe (`apps/web/src/features/profile/containers/delete-user-container.tsx:139`); passes still start only for the user the API confirmed in this visit (threat R-03).
- Interrupted wipes: the shell finishes pending wipes on start (`apps/web/src/features/shell/containers/authenticated-shell-container.tsx:51`) and clears a user's marker entry only after the API confirms that user (`apps/web/src/features/shell/containers/authenticated-shell-container.tsx:88`).
- Service worker: unchanged; it caches no API answer and no account data (spec D11).

## Info findings (not blocking)

| ID | Severity | File | Finding | Disposition |
|---|---|---|---|---|
| I-1 | Info (CWE-359) | `apps/web/src/lib/local-store/wipe-marker.ts:11` | The wipe marker keeps up to 20 user ids (opaque UUIDs) in `localStorage` until each user signs in again | Same data class as the session pointer of 04a; no name, email or financial data; needed so an interrupted wipe is finished and the database is not reopened (threat R-02) |
| I-2 | Info (CWE-922) | `apps/web/src/lib/local-store/wipe.ts:41` | The data of a user who never signs out stays on the device | Accepted risk R-09 of `threat-DISC-001-04d.md` (PRD Out of Scope); this ticket closes the earlier "not wiped on sign-out" Info findings of 04a (I-2), 04b (I-1) and 04c (I-1) for every confirmed sign out |
