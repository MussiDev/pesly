# PRD FEAT-017: Merchant logos for categories and statement lines

| Field | Value |
|-------|-------|
| Ticket | FEAT-017 |
| Tracker | none |
| Date | 2026-11-01 |
| PRD loops | 0 |
| Loops since last human decision | 0 |

## Context and Problem

Pesly shows a merchant logo on a movement row when its note names one of 40 merchants whose logo is
bundled (Simple Icons, CC0). The user wants the logo wherever a merchant is recognizable: a category
named after a merchant (for example a "Netflix" category) and the lines of an imported card
statement. Many merchants on Argentine statements (car brands and their installment plans,
clothing) have a CC0 logo that is not bundled yet.

The user chose to use only logos that can be redistributed: merchants without a cleared logo
(PedidosYa, Rappi, Mercado Libre, YPF, Coto, Día) keep the category icon.

## Goals

- A category named exactly like a merchant shows the merchant's logo.
- Statement import lines show the logo of the merchant they name.
- More merchants common on Argentine statements have a logo.

## Functional Requirements

- FR-01: A category whose whole display name is a merchant keyword (ignoring case, accents and
  punctuation) shows that merchant's logo instead of its icon, in the category list, the category
  picker, the group categories and the movement rows.
- FR-02: A category whose name only contains a merchant keyword keeps its icon.
- FR-03: When the logo fails to load, the category's own icon (or emoji) shows.
- FR-04: A movement row shows the logo of the merchant its note names first, then the logo of its
  category when the category is named like a merchant, then the category icon.
- FR-05: Each line of the statement import preview shows the logo of the merchant its description
  names, before the description.
- FR-06: The catalog adds Chevrolet, Ford, Fiat, Toyota, Renault, Volkswagen, Citroën, Nissan, Honda,
  Jeep, Hyundai (and the plans "Plan Rombo", "Plan Óvalo", "Autoahorro"), Zara, Adidas, Uniqlo,
  Paramount+, Crunchyroll, Claude, iCloud, Google Drive, Riot Games and Tinder.

## Non-Functional Requirements

- NFR-01: Every logo is a bundled CC0 file from Simple Icons, rewritten as one path with the brand
  colour, under 10 KB, listed in `public/logos/NOTICE.md`; nothing is loaded from a third party.
- NFR-02: The merchant catalog holds at most 80 entries (raised from 40).
- NFR-03: No new UI string.

## Acceptance Criteria

- AC-01 (FR-01): WHEN a category is named "Netflix", THE category list SHALL show the Netflix logo.
- AC-02 (FR-02): WHEN a category is named "Ropa de Zara y otras", THE list SHALL show its icon.
- AC-03 (FR-03): IF the logo of a category fails to load, THEN its icon SHALL show.
- AC-04 (FR-04): WHEN an expense note names Spotify and its category is "Netflix", THE row SHALL show
  the Spotify logo.
- AC-05 (FR-05): WHEN a statement line reads "CHEVROLET SA PLAN 12/84", THE preview SHALL show the
  Chevrolet logo next to it, and no logo for an unknown merchant.

## Out of Scope

- Logos of merchants without a redistributable logo; a remote logo service.
- Picking a logo by hand for a category.
