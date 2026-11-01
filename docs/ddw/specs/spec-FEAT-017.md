# Spec FEAT-017: Merchant logos for categories and statement lines

| Field | Value |
|-------|-------|
| Ticket | FEAT-017 |
| PRD | docs/ddw/prd/prd-FEAT-017.md |
| Tier | FEATURE |
| Date | 2026-11-01 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary

Web only; no API, schema or migration change.

- `public/logos/`: 21 new single-path SVGs from Simple Icons 16.34.0 (Peugeot left out: its file is
  over the 10 KB limit; Max and Puma left out: their bare keywords clash with other merchants).
  `NOTICE.md` lists them.
- `lib/logos/merchant-catalog.ts`: the 21 entries; `test/logos-catalog.test.ts` raises the cap to 80.
- `lib/logos/resolve-merchant.ts`: `resolveMerchantName`, an exact resolver: the tokenized name must
  equal a keyword's tokens (D1: a category is a merchant only when that is its whole name).
- `CategoryVisual` takes an optional `name`; with a merchant it renders the `Avatar` with the logo
  and the category icon as fallback. Call sites pass the display label.
- `MovementAvatar` takes `categoryName` after the note.
- The statement import preview renders the logo of `resolveMerchant(description)` before it.

## Tests

`test/merchant-logos-categories.test.tsx` (resolver, CategoryVisual, MovementAvatar),
`test/statement-import.test.tsx` (preview logo), the existing catalog and header checks over the new
files.
