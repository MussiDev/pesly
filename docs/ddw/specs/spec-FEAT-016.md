# Spec FEAT-016: A category per statement line, suggested and learned

| Field | Value |
|-------|-------|
| Ticket | FEAT-016 |
| PRD | docs/ddw/prd/prd-FEAT-016.md |
| Tier | FEATURE |
| Date | 2026-11-01 |
| Spec loops | 0 |
| Loops since last human decision | 0 |

## Summary

A pure module in `packages/shared` normalizes a line description into a merchant key and suggests a
category from the user's rules and a built-in merchant list. The import request gains an optional
`categoryId` per line, and the import's `categoryId` becomes optional when every line has one. The
API stores one rule per merchant in a new table, learned from the lines that carry their own
category, and serves them at `GET /credit-cards/category-rules`. The web loads the rules with the
card and the categories, pre-fills a category control per line, and sends the per-line categories.
No new dependency.

## Decisions

- **D1 — Suggest on the device.** The client already has the categories; with the rules it computes
  every suggestion locally, so descriptions are never sent for suggesting (only on import, as today).
- **D2 — Merchant key.** First three words without digits of the description, lowercase, accents
  removed, at most 80 characters; installment counters and store numbers drop out.
- **D3 — Learn only from explicit line categories.** A line booked through the general category
  teaches nothing; the last line of a merchant in one import wins; the rule is upserted.
- **D4 — Learn after the lines.** Rules are stored after every line was created or skipped, so a
  failed import teaches nothing; skipped duplicates still teach (the user re-chose them).
- **D5 — Merchant list is data, not UI copy.** Keywords and category synonyms are matching data in
  `packages/shared/src/credit-cards/category-suggestion.ts`; they are never shown. A one-word
  keyword of 6 letters or more matches the start of a word; shorter or multi-word ones match whole
  words, so "dia" does not match "diario".
- **D6 — Rules cascade.** The rule's composite key to `categories (id, owner_id, kind)` refuses an
  income category and is `on delete cascade`; the owner key cascades with the user.

## Blocks

1. Shared: `category-suggestion.ts` (`merchantKey`, `suggestCategory`, rules schemas); import schema
   with per-line `categoryId` and the refine.
2. API: migration `0042_card_category_rules` (+ rollback), `CardCategoryRules` port, Drizzle
   adapter, `ListCardCategoryRules`, per-line categories and learning in `ImportCardStatement`,
   route `GET /credit-cards/category-rules` before `/credit-cards/:id`.
3. Web: `listCardCategoryRules` in the API client, `suggestLineCategories` and
   `needsGeneralCategory` in `import-request.ts`, a category column in the preview, catalogs.

## Tests

- Shared: merchant keys, keyword groups, name/key/parent resolution, learned precedence, archived
  rule ignored, fee fallback, contract refinements, odd Unicode keys valid for the schema.
- API unit: per-line booking, no general category, every category checked first, learning and
  last-wins, nothing learned on failure, learning on skipped lines.
- API routes: per-line booking in the database, rules per owner, upsert, 400 without category, 404
  for another user's category, cascade on category delete, 401 without session; migration registry,
  rollback chains and user erasure.
- Web: pre-fill and source labels, import without general category, general category required when
  a line is cleared, rules failure fallback, English labels.
