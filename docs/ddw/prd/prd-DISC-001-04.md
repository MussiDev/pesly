# Parent PRD: Offline Entry & Sync

| Metric | Value |
|--------|-------|
| Ticket | DISC-001-04 |
| Date | 2026-10-04 |
| Status | Split |

## Sub-tickets

| Sub-ticket | Title | PRD | Dependencies | Status |
|---|---|---|---|---|
| DISC-001-04a | Local Store, App Shell and Reference Cache | prd-DISC-001-04a.md | PRD 01, 02 and 03 (all merged) | done: branch `feat/DISC-001-04a-local-store-app-shell`, no migration; must ship together with 04d, because the copy on the device is not wiped on sign-out until then (threat R-03); next: 04b |
| DISC-001-04b | Offline Entry and Sync of New Movements | prd-DISC-001-04b.md | depends on a | done: branch `feat/DISC-001-04b-offline-entry-sync` (draft PR #31, on top of 04a, merged), migration 0018 (journal `when` 1791162359112, above main's maximum on 2026-10-06; check it again at merge); must NOT be merged or released alone: a movement the server refuses stays queued and unseen until 04c, so it ships with 04c, and 04a still waits for 04d (threat R-03, R-08); a dry-run merge of `main` (22 commits ahead, FEAT-005) was clean; next: 04c |
| DISC-001-04c | Offline Edit and Delete, Sync States, Failures and Retries | prd-DISC-001-04c.md | depends on a and b; DISC-001-03e is merged (#27), so editing and deleting exist | active |
| DISC-001-04d | Session, Sign Out and Local Data | prd-DISC-001-04d.md | depends on a and b | pending |
| DISC-001-04e | Conflicts on Group Movements | prd-DISC-001-04e.md | depends on c; blocked by PRD 05 (Groups & Expense Splitting), which is not built | blocked — needs PRD 05 |

## Suggested implementation order
a → b → c → d → e (d only needs a and b, so it can also go before c; e starts when PRD 05 is
merged)

## Pending decisions (not resolved in the sub-PRDs)
1. **Release unit of b and c** (found while splitting; for the user). DISC-001-04b queues new
   movements and sends them, but a change the server rejects stays unseen until DISC-001-04c adds
   the failed state. Recommended: 04b and 04c are merged to `main` together, or 04b is not
   deployed alone; the PRD of 04b says so. Alternative: ship 04b alone and accept that a rejected
   queued movement is retried silently.
2. **When the device cache refreshes** (for DISC-001-04a's PLAN). The original FR-06 and FR-07 keep
   a copy of the reference data and of the 100 most recent movements, and do not say when it is
   refreshed. Recommended: on app start, when connectivity returns and after every successful
   sync, keeping the last copy while offline.
3. **Service worker update strategy** (for DISC-001-04a's PLAN). The original NFR-07 caches the
   application shell and does not say how a new deploy reaches a device. Recommended: install the
   new version in the background and use it from the next start, with no forced reload.
4. **The create contract with an identifier from the device** (for DISC-001-04b's PLAN). FR-02 and
   FR-05 need `POST /movements` to accept the id. Recommended: the same owner sending an id that
   exists gets the stored movement back and no second row; an id that belongs to another user is
   answered without revealing it. The exact status codes are a PLAN decision with its threat
   model.
5. **Data of the previous user when a different user signs in** (for DISC-001-04d's PLAN). The
   original AC-21 only forbids sending the first user's changes under the new user. Recommended:
   the local store is scoped per user, and the previous user's data stays until a confirmed sign
   out wipes it.
6. **Version of a group movement** (for DISC-001-04e's PLAN). "A change made on an older version"
   needs a version on the movement that changes with every edit, so the schema gains a column.
   Counter or timestamp is open.

## Added while splitting (not in the original text)
Each addition is derived from an obligation or decision already on record in the original PRD;
none changes an original requirement. They were ACCEPTED by the human on 2026-10-04.

| New ID | What | Why |
|---|---|---|
| 04a FR-04, AC-04 | Cache the application shell with a service worker | the original NFR-07 asked for it as a metric only; a requirement without an action cannot be built or tested |
| 04a FR-05, FR-06, AC-05, AC-06 | Request persistent storage and warn when it is denied | the Decision Log of 2026-09-25 approved it and the Risks section relies on it, but no FR or AC carried it |
| 04a AC-03 | Keep only the 100 most recent movements on the device | splits the original FR-07 (keep) from its view and edit parts |
| 04c FR-07, AC-07 | Send the queued edits and deletions automatically | the original FR-04 and AC-05 sent "the queued changes"; 04b sends the new movements, so 04c sends the rest |
| 04c FR-02 (three states) | The sync state has pending, synced and failed here | the fourth state, conflict, exists only for group movements and is added by 04e |
| 04d FR-01, FR-02 | The original FR-17 held two behaviors | each gets its own requirement so each criterion names one |
| 04e FR-04, AC-05 | The sync state conflict | the original FR-09 listed it; 04c leaves it out |
| 04e NFR-01 | Resolving a conflict deletes 0 versions before the user chooses | turns the original FR-14 into a measurable number |

## Original context
PRD 04 of discovery DISC-001 defined recording movements without connectivity and syncing them
later. With 19 functional requirements, 7 non-functional requirements and 23 acceptance criteria,
three modules (web, API, shared), a browser platform that does not exist in the code yet (no
service worker, no local database) and a dependency on a PRD that is not built, it was too large
for one ticket, so it was split on 2026-10-04 (user decision). The full original text is in git
history (file `docs/ddw/prd/prd-DISC-001-04.md` before the split).

## Traceability: original ID → sub-ticket ID

Other PRDs of DISC-001 reference this PRD as "PRD 04, FR-xx"; use this table to resolve them. A row
with two entries means the original requirement was divided.

| Original | Now |
|---|---|
| FR-01 | DISC-001-04b FR-01 |
| FR-02 | DISC-001-04b FR-02 |
| FR-03 | DISC-001-04b FR-03 |
| FR-04 | DISC-001-04b FR-04 (new movements) and DISC-001-04c FR-07 (edits and deletions) |
| FR-05 | DISC-001-04b FR-05 |
| FR-06 | DISC-001-04a FR-01 |
| FR-07 | DISC-001-04a FR-02 and FR-03 (keep, view) and DISC-001-04c FR-01 (edit, delete) |
| FR-08 | DISC-001-04b FR-06 |
| FR-09 | DISC-001-04c FR-02 (pending, synced, failed) and DISC-001-04e FR-04 (conflict) |
| FR-10 | DISC-001-04c FR-03 |
| FR-11 | DISC-001-04c FR-04 |
| FR-12 | DISC-001-04e FR-01 |
| FR-13 | DISC-001-04e FR-02 |
| FR-14 | DISC-001-04e FR-03 |
| FR-15 | DISC-001-04c FR-05 |
| FR-16 | DISC-001-04c FR-06 |
| FR-17 | DISC-001-04d FR-01 and FR-02 |
| FR-18 | DISC-001-04d FR-03 |
| FR-19 | DISC-001-04d FR-04 |
| NFR-01 | DISC-001-04a NFR-01 |
| NFR-02 | DISC-001-04b NFR-01 |
| NFR-03 | DISC-001-04b NFR-02 |
| NFR-04 | DISC-001-04c NFR-01 |
| NFR-05 | DISC-001-04b NFR-03 |
| NFR-06 | DISC-001-04d NFR-01 |
| NFR-07 | DISC-001-04a NFR-02 |
| AC-01 | DISC-001-04b AC-01 |
| AC-02 | DISC-001-04b AC-02 |
| AC-03 | DISC-001-04b AC-03 |
| AC-04 | DISC-001-04b AC-04 |
| AC-05 | DISC-001-04b AC-05 (copied to DISC-001-04c AC-07 for edits and deletions) |
| AC-06 | DISC-001-04b AC-06 |
| AC-07 | DISC-001-04a AC-01 |
| AC-08 | DISC-001-04a AC-02 |
| AC-09 | DISC-001-04c AC-01 |
| AC-10 | DISC-001-04b AC-07 |
| AC-11 | DISC-001-04c AC-02 (pending, synced, failed) and DISC-001-04e AC-05 (conflict) |
| AC-12 | DISC-001-04c AC-03 |
| AC-13 | DISC-001-04c AC-04 |
| AC-14 | DISC-001-04e AC-01 |
| AC-15 | DISC-001-04e AC-02 |
| AC-16 | DISC-001-04e AC-03 |
| AC-17 | DISC-001-04e AC-04 |
| AC-18 | DISC-001-04c AC-05 |
| AC-19 | DISC-001-04c AC-06 |
| AC-20 | DISC-001-04d AC-01 |
| AC-21 | DISC-001-04d AC-02 |
| AC-22 | DISC-001-04d AC-03 |
| AC-23 | DISC-001-04d AC-04 |
