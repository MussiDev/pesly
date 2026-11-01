# PRD FEAT-016: A category per statement line, suggested and learned

| Field | Value |
|-------|-------|
| Ticket | FEAT-016 |
| Tracker | none |
| Date | 2026-11-01 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem

The card statement import (DISC-001-10, FEAT-005) books every imported line in one category chosen
for the whole file. A statement mixes very different spending (a car plan installment, fuel,
groceries, streaming), so the user ends up with everything in one category and has to fix each
movement by hand afterwards.

The user asked that Pesly read the statement and suggest a category per line: for example a line
that says "Chevrolet" goes to their "Auto" category.

## Goals

- Each imported line can have its own category, chosen in the preview before importing.
- Pesly pre-fills the category of each line it recognizes.
- What the user chooses is remembered and suggested on the next import of the same merchant.
- No line description leaves the device or the API for a third party.

## Functional Requirements

- FR-01: The import preview shows, for each line that will be imported, a category control with the
  user's open expense categories and a "use the general category" option.
- FR-02: A line's own category is used for that line; the general category is used for the lines
  without one, and is required only when such a line exists.
- FR-03: When the preview opens, each line is pre-filled with a suggestion when there is one; the
  user can change or clear any of them.
- FR-04: A suggestion first comes from the rule the user taught for the line's merchant, and
  otherwise from a built-in list of common merchants in Argentina mapped to kinds of spending.
- FR-05: A built-in suggestion picks the user's category whose name matches the kind of spending
  (for example a category named "Auto" for a car brand), otherwise the matching default category,
  otherwise its parent default category.
- FR-06: A fee line with no other suggestion is suggested the taxes and fees category.
- FR-07: The control says whether a pre-filled category comes from earlier imports or from the
  merchant, while it keeps the suggested value.
- FR-08: Each imported line with its own category teaches the rule of its merchant: the first three
  words of the description without digits, lowercase and without accents. A later import replaces
  the rule of the same merchant.
- FR-09: A rule whose category is archived or deleted is not suggested; deleting the category
  deletes its rules.
- FR-10: The import works the same when the rules cannot be read; only the learned suggestions are
  missing.

## Non-Functional Requirements

- NFR-01: Suggestions are computed on the device from data already loaded, with one extra request
  per screen (the rules); no request per line.
- NFR-02: The rules are scoped by owner; another user's rules or categories are never read and
  answer 404 when used.
- NFR-03: No external service is called; the merchant list ships with the app.
- NFR-04: 0 new strings missing from the Spanish and English catalogs.

## Acceptance Criteria

- AC-01 (FR-01, FR-05): WHEN the user has a category named "Auto" and imports a line
  "CHEVROLET SA PLAN 12/84", THE preview SHALL pre-fill "Auto" for it.
- AC-02 (FR-02): WHEN every imported line has its own category, THE import SHALL succeed without a
  general category.
- AC-03 (FR-02): WHEN a line is set to the general category and none is chosen, THE preview SHALL
  ask for it and send nothing.
- AC-04 (FR-04, FR-08): WHEN the user imported "CHEVROLET SA PLAN 12/84" as "Car" and later imports
  "CHEVROLET SA PLAN 13/84", THE preview SHALL pre-fill "Car" and say it comes from earlier imports.
- AC-05 (FR-06): WHEN a fee line matches no merchant, THE preview SHALL pre-fill the taxes and fees
  category.
- AC-06 (FR-09): WHEN the category of a rule is archived, THE preview SHALL NOT pre-fill it.
- AC-07 (FR-10): IF the rules request fails, THEN THE preview SHALL still suggest from the merchant
  list.
- AC-08 (NFR-02): IF a line carries another user's category, THEN THE import SHALL answer 404 and
  store nothing.

## Out of Scope

- Changing the category of lines imported before this change.
- Suggestions outside the statement import (manual expenses, recurring payments).
- Managing the learned rules on their own screen.

## Risks and Mitigations

- **A wrong suggestion is accepted without looking.** Mitigation: the source of each suggestion is
  shown, and the next import learns the correction.
- **The merchant list ages.** Mitigation: it is data in one shared file, and learned rules take
  precedence.
