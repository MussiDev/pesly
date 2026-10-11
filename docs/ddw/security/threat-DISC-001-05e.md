# Threat model DISC-001-05e: Groups Screens, Members and Invitations

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05e |
| Spec | docs/ddw/specs/spec-DISC-001-05e.md |
| Tier | FEATURE |
| Date | 2026-10-11 |

## Components
| Component | Source in the spec |
|---|---|
| `apps/web/src/lib/api-client.ts` | Block 1 |
| `apps/web/src/features/groups/containers/groups-list-container.tsx` | Block 2 |
| `apps/web/src/features/groups/containers/group-detail-container.tsx` | Block 3 |
| `apps/web/src/features/groups/group-link.ts` | Block 4 |
| `apps/web/src/features/groups/containers/join-group-container.tsx` | Block 5 |
| `apps/web/src/features/groups/containers/group-categories-container.tsx` | Block 6 |

## Trust boundaries
- Browser → API: the screens call existing group routes with the session cookie; the API's own
  validation, `GroupAccess` guard and role checks stay authoritative.
- Address bar and history → page: an invitation or claim token arrives in the link and must not
  linger in the address bar, the history or any request URL.
- Page → clipboard and share sheet: the link leaves the page to places the app does not control.
- Group data → other members: the detail shows names and roles of members of the same group only.

## STRIDE analysis
### `apps/web/src/lib/api-client.ts`
- **Spoofing:** the caller identity is the session cookie; no user id is ever sent from the client.
- **Tampering:** every response is parsed with the shared validators, so a modified or malformed body
  becomes a generic failure and never partial data.
- **Repudiation:** not applicable on the client; the server records actions.
- **Information Disclosure:** failures expose only message keys and, for the leave and removal answers,
  the group's own balance amounts; no token is logged by the client.
- **Denial of Service:** one request per user action; no polling or retry loop is added.
- **Elevation of Privilege:** the client never decides permissions; a 403 is displayed as received.

### `apps/web/src/features/groups/containers/groups-list-container.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** the list is read-only data from the API; the create form validates input and the API
  validates again.
- **Repudiation:** not applicable.
- **Information Disclosure:** the API lists only the caller's groups; the screen adds nothing else.
- **Denial of Service:** one request on load.
- **Elevation of Privilege:** not applicable; creating a group makes the caller its admin on the server.

### `apps/web/src/features/groups/containers/group-detail-container.tsx`
- **Spoofing:** the caller's role comes from the loaded group, not from a client-side claim.
- **Tampering:** admin actions send ids taken from the loaded group; the API re-checks the role and
  membership and answers 403 or 404.
- **Repudiation:** removals and role changes are server side and, in 05d, logged.
- **Information Disclosure:** a non-member gets 404 and the screen shows the not-found state without
  hints; balances in a blocked leave belong to the caller's own group.
- **Denial of Service:** at most two requests on load.
- **Elevation of Privilege:** hiding admin controls is a convenience only; a forged request is refused by
  the API, and the screen shows the refusal.

### `apps/web/src/features/groups/group-link.ts`
- **Spoofing:** the link is built only from a token the API returned to an authorised member.
- **Tampering:** the token travels in the URL fragment, which is never sent to a server, so a proxy or
  referrer cannot read or alter it in transit.
- **Repudiation:** not applicable.
- **Information Disclosure:** the fragment form keeps the token out of server logs and the Referer
  header; the link is shown only to the member who asked for it.
- **Denial of Service:** not applicable.
- **Elevation of Privilege:** an invitation lets someone join, which is its purpose; it expires in 7
  days and the member limit is enforced by the API.

### `apps/web/src/features/groups/containers/join-group-container.tsx`
- **Spoofing:** the join acts as the signed-in user; a user who is not signed in must sign in first.
- **Tampering:** the token is read once from the fragment and sent in the request body, never in a
  query string; a double mount cannot send it twice.
- **Repudiation:** not applicable.
- **Information Disclosure:** the token is removed from the address bar before any request and appears
  in no history entry; the page never renders it back and error states do not echo it.
- **Denial of Service:** one request per attempt; the API rate limits repeated attempts.
- **Elevation of Privilege:** a claim link assigns the seat to the caller only; used or invalid links
  change nothing on the server.

### `apps/web/src/features/groups/containers/group-categories-container.tsx`
- **Spoofing:** not applicable below the session.
- **Tampering:** only an admin sees the controls; the API enforces the admin rule.
- **Repudiation:** not applicable.
- **Information Disclosure:** names, icons and colors of the group's own categories.
- **Denial of Service:** one request on load.
- **Elevation of Privilege:** a regular member who forges a request gets 403 from the API.

## Data classification
| Data | Class | At rest | In transit |
|---|---|---|---|
| Group name, member names and roles | personal | PostgreSQL, managed encryption at rest | HTTPS only |
| Invitation and claim tokens | credential-like | server side only until used or expired; never stored in the browser | URL fragment and HTTPS request body |
| Balances shown when leaving | financial | PostgreSQL | HTTPS only |

## Risks and mitigations
| ID | Risk | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| R-01 | An invitation token leaks through server logs, the Referer header or browser history | I | Medium | High | Token in the fragment, removed with `replaceState` before any request, tested for 0 history entries (Blocks 4, 5) |
| R-02 | A token is consumed twice by a double mount or a retry | T | Medium | Medium | Single guarded request, retry only after a failure (Block 5 test) |
| R-03 | A regular member uses admin actions by forging requests | E | Low | High | The API answers 403; the screens show it and hide the controls (Blocks 3, 6) |
| R-04 | A screen leaks the existence of a group to a non-member | I | Low | Medium | 404 renders the same not-found state (Block 3 test) |
| R-05 | A hardcoded string or one-language screen ships | T | Medium | Low | Catalog parity and no-literal scan (Block 7) |
| R-06 | The link is copied to an untrusted place by the user | I | Medium | Low | Accepted: copying is the feature; the link expires in 7 days and is single group, member limited |

## Supply chain
No new runtime dependency (spec D8); the screens use React, the existing design system components and the
existing api-client.
