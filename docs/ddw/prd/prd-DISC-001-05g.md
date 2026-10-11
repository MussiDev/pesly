# PRD DISC-001-05g: Balances and Settlements Screens

| Field | Value |
|-------|-------|
| Ticket | DISC-001-05g |
| Tracker | none |
| Date | 2026-10-11 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem
Third of four web sub-tickets of PRD 05 (parent index: `prd-DISC-001-05.md`; 05e groups and members,
05f expenses, 05h editing, activity and conflicts). The API already answers "who owes whom"
(`GET /groups/:id/balances`), records settlements (`POST /groups/:id/settlements`), previews the
consolidation of two currencies (`GET /groups/:id/settlements/consolidation`) and lists the history
(`GET /groups/:id/settlements`), but no screen uses them. Members cannot see what they owe, pay a
suggested payment or consolidate ARS and USD into one currency. This ticket builds those screens and the
four missing api-client methods. It adds no endpoint. Editing and deleting a settlement belong to 05h.

## Goals
- A member sees each member's balance per currency and the minimum list of payments that settles the group.
- A member records a payment between two members in one tap from a suggested payment, optionally moving
  money in one of their own accounts.
- Two members settle both currencies in one, previewing the rate and replacing it when they disagree.
- A member reads the history of settlements.

## Functional Requirements
- FR-01: The system must add to the api-client the methods to read the group balances, list settlements,
  record a settlement and preview a consolidation.
- FR-02: The system must show, on a balances page of the group, each member's balance per currency (ARS and
  USD separately), marking who owes and who is owed.
- FR-03: The system must show, per currency, the suggested payments as "A pays B amount", and an empty
  state when the currency has none.
- FR-04: The system must let a member record a suggested payment, prefilling the two members, the currency,
  the amount and the current date.
- FR-05: The system must let a member record a payment between any two active members by choosing who pays,
  who receives, the currency, the amount and the date.
- FR-06: The system must let a member who is a party to a settlement choose one of their own open accounts of
  the settlement currency, or none.
- FR-07: The system must let two members start a consolidated settlement by choosing both members and the
  currency to settle in, and show the preview: the amount in each currency, the group's default rate type
  and its rate.
- FR-08: The system must let the member replace the prefilled rate of a consolidated settlement with a
  manual rate before recording it.
- FR-09: The system must show the result of a consolidated settlement as the amount to pay in the chosen
  currency, in a single confirmation.
- FR-10: The system must list the group's settlements, newest first, with the parties, the amount, the date
  and a marker for consolidated ones, loading more on request.
- FR-11: The system must link the balances page from the group detail and show the user's own balance there.
- FR-12: The system must show every string in Spanish and English from the i18n catalogs and every amount
  with the locale formatters.

## Non-Functional Requirements
- NFR-01: Each screen must render without horizontal scrolling at a 360 px wide viewport, verified by an
  end-to-end test at that width.
- NFR-02: The balances page must load its data with at most 2 API requests (the group and its balances),
  verified by a test that counts the calls.
- NFR-03: The Spanish and English catalogs must have 0 missing or empty keys, verified by the existing
  catalog parity test.
- NFR-04: Every amount and rate must travel as a string and be converted with the shared money helpers, with
  0 floating-point conversions, verified by a test over 1,000 random amounts that the amount
  sent equals the amount typed.

## Acceptance Criteria
*(EARS)*
- AC-01 (FR-01): WHEN a screen asks for the balances, a settlement list, a settlement record or a
  consolidation preview, THE api-client SHALL call the matching endpoint and return the validated response.
- AC-02 (FR-02): WHEN a member opens the balances page, THE system SHALL show each member's balance in ARS
  and in USD separately.
- AC-03 (FR-02): WHEN a member's balance is negative, THE system SHALL mark them as owing, and when it is
  positive as owed.
- AC-04 (FR-03): WHEN a currency has suggested payments, THE system SHALL list each as the payer, the payee
  and the amount.
- AC-05 (FR-03): WHILE every balance of a currency is 0, THE system SHALL show that the currency is settled
  and no payments.
- AC-06 (FR-04): WHEN a member chooses "record" on a suggested payment, THE system SHALL open the form with
  the members, currency, amount and date prefilled.
- AC-07 (FR-05): WHEN a member submits a payment between two members, THE system SHALL record it and show
  the updated balances.
- AC-08 (FR-05): IF the amount is empty, 0 or less, or the same member is chosen on both sides, THEN THE
  system SHALL show a field error and not send the request.
- AC-09 (FR-05): IF the API rejects the settlement because a member is no longer active, THEN THE system
  SHALL show that message and keep the form.
- AC-10 (FR-06): WHEN the member is a party to the settlement, THE system SHALL offer their open accounts of
  the settlement currency and send the one chosen.
- AC-11 (FR-06): WHILE the member is not a party to the settlement, THE system SHALL not offer an account.
- AC-12 (FR-07): WHEN two members and a currency are chosen, THE system SHALL show the preview with the
  amount in each currency, the rate type and the rate.
- AC-13 (FR-07): IF the two members have nothing to consolidate, THEN THE system SHALL say so and not offer
  to record.
- AC-14 (FR-08): WHEN the member replaces the rate with a value greater than 0, THE system SHALL record the
  consolidated settlement with that rate.
- AC-15 (FR-08): IF the replacement rate is empty or 0 or less, THEN THE system SHALL show a field error and
  not send the request.
- AC-16 (FR-09): WHEN a consolidated settlement is recorded, THE system SHALL show the amount that changes
  hands in the chosen currency and both balances at 0.
- AC-17 (FR-09): IF the API answers that the debts moved after the preview, THEN THE system SHALL reload the
  preview and ask the member to confirm again.
- AC-18 (FR-10): WHEN a member opens the history, THE system SHALL list settlements newest first with
  parties, amount, date and the consolidated marker.
- AC-19 (FR-10): WHEN more settlements exist than one page, THE system SHALL offer to load more and append
  them without repeating any.
- AC-20 (FR-11): WHEN a member opens the group detail, THE system SHALL show a link to the balances page.
- AC-21 (FR-11): WHEN the balances page opens, THE system SHALL show the user's own balance per currency
  first.
- AC-22 (FR-12): WHERE the interface language is Spanish or English, THE system SHALL show every string of
  these screens in that language.
- AC-23 (FR-02): IF the user is not a member of the group, THEN THE system SHALL show the not-found state.

## Out of Scope
- Editing and deleting settlements, the activity log and conflict resolution (05h).
- Group expenses and splits (05f).
- Offline use of any of these screens and offline recording of settlements (PRD 05 decision).
- Payments through the app (Mercado Pago, transfers): settlements are only recorded.
- Charts, exports and dashboard figures of balances (PRD 09).
- Netting a ghost member's balance: someone records the settlement for them with the same form.

## Risks and Mitigations
- **A member records the wrong direction of a payment** → the suggested payment prefills it, and the form
  shows "A pays B" in words before sending (FR-04, FR-05).
- **Disputes over the consolidation rate** → the preview names the rate type and shows the rate, and the
  member can replace it (FR-07, FR-08).
- **The preview is stale when recording** → the API answers 409 and the screen reloads the preview
  (AC-17).
- **A float slips into money** → amounts stay strings and go through the shared helpers (NFR-04).
- **Large surface in one ticket** → one container per screen, shared patterns of 05e; no new dependency.

## Dependencies
- DISC-001-05c (balances and settlements API) and 05d (settlement versions) — merged.
- DISC-001-05e (draft PR #54) — the group detail container, group failure mapping and navigation this
  ticket extends. This ticket branches from it.
- DISC-001-05f (in progress in another session) — touches the same api-client file; merge order decides who
  rebases.
- PRD 02 (accounts) — the account list for the account choice.
- FEAT-004 (design system) — components and tokens.

## Decision Log
- 2026-10-11: Group web UI split into 05e to 05h; 05g covers balances and settlements. Proposed by the
  model, awaiting the owner's acceptance.
- 2026-10-11: The balances page is a separate route under the group, not part of the detail page, so the
  detail keeps its 2-request budget (05e NFR-02).
