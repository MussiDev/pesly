import { describe, expect, it } from 'vitest';
import {
  MOVEMENT_TAGS_MAX_COUNT,
  MOVEMENT_TAG_MAX_LENGTH,
  TAG_SUGGESTIONS_MAX_LIMIT,
  createMovementRequestSchema,
  listTagsQuerySchema,
  listTagsResponseSchema,
  movementTagSchema,
  movementTagsSchema,
  tagSuggestionsQuerySchema,
  tagSuggestionsResponseSchema,
} from '../src';

const base = {
  type: 'expense',
  accountId: '0b9d1f6e-5a3c-4c8e-9a43-2f1d7a6b8c90',
  categoryId: '5d7c2b1a-9e84-4f3a-8b61-0c2d4e6f8a10',
  amount: '150050',
  occurredAt: '2026-10-02T15:30:00Z',
  rate: { source: 'automatic' },
};

const entries = (count: number) => Array.from({ length: count }, (_, i) => `tag${i}`);

describe('movement tags', () => {
  it('exposes the limits', () => {
    expect(MOVEMENT_TAG_MAX_LENGTH).toBe(30);
    expect(MOVEMENT_TAGS_MAX_COUNT).toBe(10);
    expect(TAG_SUGGESTIONS_MAX_LIMIT).toBe(20);
  });

  it('parses 1 and 10 tags keeping order and the first spelling (AC-03)', () => {
    expect(movementTagsSchema.parse(['viaje'])).toEqual(['viaje']);
    expect(movementTagsSchema.parse(entries(10))).toEqual(entries(10));
    expect(movementTagsSchema.parse(['b', 'Trip', 'a', 'trip', 'TRIP'])).toEqual([
      'b',
      'Trip',
      'a',
    ]);
    expect(movementTagsSchema.parse([])).toEqual([]);
  });

  it('rejects an 11th entry, even when it repeats another (AC-04)', () => {
    expect(movementTagsSchema.safeParse(entries(11)).success).toBe(false);
    expect(movementTagsSchema.safeParse([...entries(10), 'TAG0']).success).toBe(false);
  });

  it('rejects empty, blank, 31 code points and control characters; accepts 1 and 30 (AC-06)', () => {
    const bad = ['', '   ', 'a'.repeat(31), 'ab\u0000c', 'a​b', '\u0000ab', '😀'.repeat(31)];
    for (const value of bad) {
      expect(movementTagSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
    expect(movementTagSchema.parse('a')).toBe('a');
    expect(movementTagSchema.parse('a'.repeat(30))).toBe('a'.repeat(30));
    expect(movementTagSchema.parse('😀'.repeat(30))).toBe('😀'.repeat(30));
    expect(movementTagSchema.parse('  viaje  ')).toBe('viaje');
  });

  it('treats composed and decomposed forms as one tag and folds case (AC-03)', () => {
    const composed = 'Árbol';
    const decomposed = 'Árbol';
    expect(composed).not.toBe(decomposed);
    expect(movementTagSchema.parse(decomposed)).toBe(composed);
    expect(movementTagsSchema.parse([composed, decomposed])).toEqual([composed]);
    expect(movementTagsSchema.parse(['VIAJE', 'viaje'])).toEqual(['VIAJE']);
  });

  it('never echoes the rejected value in the issues', () => {
    const result = movementTagSchema.safeParse('secret\u0000');
    expect(JSON.stringify(result.error?.issues)).not.toContain('secret');
  });

  it('is optional on the create request, and the old body still parses (AC-03)', () => {
    const old = createMovementRequestSchema.parse(base);
    expect('tags' in old ? old.tags : undefined).toBeUndefined();
    const withTags = createMovementRequestSchema.parse({ ...base, tags: ['Trip', 'trip'] });
    expect('tags' in withTags ? withTags.tags : undefined).toEqual(['Trip']);
    expect(createMovementRequestSchema.safeParse({ ...base, tags: entries(11) }).success).toBe(
      false,
    );
  });
});

describe('tag suggestions query', () => {
  it('defaults the limit to 10 and accepts 1 and 20 (AC-05)', () => {
    expect(tagSuggestionsQuerySchema.parse({ prefix: 'vi' })).toEqual({ prefix: 'vi', limit: 10 });
    expect(tagSuggestionsQuerySchema.parse({ prefix: 'vi', limit: '1' }).limit).toBe(1);
    expect(tagSuggestionsQuerySchema.parse({ prefix: 'vi', limit: '20' }).limit).toBe(20);
  });

  it('rejects an empty, blank or too long prefix (AC-05)', () => {
    for (const prefix of ['', '   ', 'a'.repeat(31), 'a\u0000']) {
      expect(tagSuggestionsQuerySchema.safeParse({ prefix }).success, JSON.stringify(prefix)).toBe(
        false,
      );
    }
    expect(tagSuggestionsQuerySchema.safeParse({}).success).toBe(false);
  });

  it('rejects a limit of 0, 21 or blank (AC-05)', () => {
    for (const limit of ['0', '21', '', ' ']) {
      expect(
        tagSuggestionsQuerySchema.safeParse({ prefix: 'vi', limit }).success,
        JSON.stringify(limit),
      ).toBe(false);
    }
  });

  it('strips unknown keys', () => {
    expect(tagSuggestionsQuerySchema.parse({ prefix: 'vi', ownerId: 'x' })).not.toHaveProperty(
      'ownerId',
    );
  });

  it('validates the response shape', () => {
    expect(tagSuggestionsResponseSchema.safeParse({ items: ['a', 'b'] }).success).toBe(true);
    expect(tagSuggestionsResponseSchema.safeParse({ items: [1] }).success).toBe(false);
  });
});

describe('list all tags', () => {
  it('defaults to limit 50 and offset 0 and accepts limit 100 (FR-01)', () => {
    expect(listTagsQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(listTagsQuerySchema.parse({ limit: '100', offset: '10' })).toEqual({
      limit: 100,
      offset: 10,
    });
  });

  it('rejects a limit of 0, 101, blank or not an integer as invalid (FR-01)', () => {
    for (const limit of ['0', '101', '', ' ', '1.5', 'abc']) {
      expect(listTagsQuerySchema.safeParse({ limit }).success, JSON.stringify(limit)).toBe(false);
    }
  });

  it('rejects a negative, blank or fractional offset as invalid (FR-01)', () => {
    for (const offset of ['-1', '', ' ', '2.5', 'abc']) {
      expect(listTagsQuerySchema.safeParse({ offset }).success, JSON.stringify(offset)).toBe(false);
    }
  });

  it('strips unknown keys, so the owner can never come from the query (FR-01)', () => {
    expect(listTagsQuerySchema.parse({ ownerId: 'x' })).not.toHaveProperty('ownerId');
  });

  it('accepts a page of tags and refuses a missing total (FR-01)', () => {
    const page = { items: ['Viaje', 'comida'], total: 2, limit: 50, offset: 0 };
    expect(listTagsResponseSchema.safeParse(page).success).toBe(true);
    expect(listTagsResponseSchema.safeParse({ items: ['a'], limit: 50, offset: 0 }).success).toBe(
      false,
    );
    expect(listTagsResponseSchema.safeParse({ ...page, items: [1] }).success).toBe(false);
  });
});
