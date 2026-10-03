import { describe, expect, it } from 'vitest';
import {
  CATEGORY_COLORS,
  CATEGORY_EMOJIS,
  CATEGORY_ICONS,
  CATEGORY_KINDS,
  EMOJI_ICON_PREFIX,
  ERROR_CODES,
  categoryIdParamsSchema,
  categoryNameSchema,
  categoryResponseSchema,
  createCategoryRequestSchema,
  listCategoriesQuerySchema,
  listCategoriesResponseSchema,
  updateCategoryRequestSchema,
} from '@pesly/shared';

const valid = { name: 'Pets', kind: 'expense', icon: 'utensils', color: 'blue' } as const;
const UUID = '0b0f6f0e-8c1d-4c8e-9a53-3d1f2a9c5b11';

function failedPaths(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}): string[] {
  return (result.error?.issues ?? []).map((i) => i.path.map(String).join('.'));
}

describe('lists', () => {
  it('offers the two kinds, 60 icons, a curated emoji list and 12 colors', () => {
    expect([...CATEGORY_KINDS]).toEqual(['expense', 'income']);
    expect(CATEGORY_ICONS).toHaveLength(60);
    expect(new Set(CATEGORY_ICONS).size).toBe(60);
    expect(CATEGORY_EMOJIS.length).toBeGreaterThan(40);
    expect(new Set(CATEGORY_EMOJIS).size).toBe(CATEGORY_EMOJIS.length);
    expect(CATEGORY_COLORS).toHaveLength(12);
    expect(new Set(CATEGORY_COLORS).size).toBe(12);
  });

  it('declares the four category error codes', () => {
    for (const code of [
      'CATEGORY_NAME_TAKEN',
      'CATEGORY_IN_USE',
      'CATEGORY_NESTING_TOO_DEEP',
      'CATEGORY_PARENT_KIND_MISMATCH',
    ]) {
      expect(ERROR_CODES as readonly string[]).toContain(code);
    }
  });
});

describe('createCategoryRequestSchema', () => {
  it('accepts a valid body, with and without a parent', () => {
    expect(createCategoryRequestSchema.safeParse(valid).success).toBe(true);
    expect(createCategoryRequestSchema.safeParse({ ...valid, parentId: UUID }).success).toBe(true);
  });

  it('accepts every listed icon, color and kind', () => {
    for (const icon of CATEGORY_ICONS) {
      expect(createCategoryRequestSchema.safeParse({ ...valid, icon }).success).toBe(true);
    }
    for (const emoji of CATEGORY_EMOJIS) {
      const icon = `${EMOJI_ICON_PREFIX}${emoji}`;
      expect(createCategoryRequestSchema.safeParse({ ...valid, icon }).success).toBe(true);
    }
    for (const color of CATEGORY_COLORS) {
      expect(createCategoryRequestSchema.safeParse({ ...valid, color }).success).toBe(true);
    }
    for (const kind of CATEGORY_KINDS) {
      expect(createCategoryRequestSchema.safeParse({ ...valid, kind }).success).toBe(true);
    }
  });

  it.each(['name', 'kind', 'icon', 'color'] as const)('rejects a missing %s and names it', (f) => {
    const body: Record<string, unknown> = Object.fromEntries(
      Object.entries(valid).filter(([key]) => key !== f),
    );
    const result = createCategoryRequestSchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(failedPaths(result)).toContain(f);
  });

  it.each(['emoji:', 'emoji:x', 'emoji:\u{1F9A4}', '\u{1F355}', 'emoji:\u{1F355}\u{1F355}'])(
    'refuses the emoji icon %j: only the curated list is allowed',
    (icon) => {
      const result = createCategoryRequestSchema.safeParse({ ...valid, icon });
      expect(result.success).toBe(false);
      expect(failedPaths(result)).toContain('icon');
    },
  );

  it('fails on an icon outside the list and names it', () => {
    const result = createCategoryRequestSchema.safeParse({ ...valid, icon: 'rocket' });
    expect(result.success).toBe(false);
    expect(failedPaths(result)).toContain('icon');
  });

  it('fails on a color outside the list, including raw values', () => {
    for (const color of ['chartreuse', '#ff0000', '']) {
      const result = createCategoryRequestSchema.safeParse({ ...valid, color });
      expect(result.success).toBe(false);
      expect(failedPaths(result)).toContain('color');
    }
  });

  it('fails on a kind other than expense or income', () => {
    const result = createCategoryRequestSchema.safeParse({ ...valid, kind: 'transfer' });
    expect(result.success).toBe(false);
    expect(failedPaths(result)).toContain('kind');
  });

  it('fails on a parentId that is not a UUID', () => {
    const result = createCategoryRequestSchema.safeParse({ ...valid, parentId: 'abc' });
    expect(result.success).toBe(false);
    expect(failedPaths(result)).toContain('parentId');
  });

  it('trims and normalizes the name', () => {
    const result = createCategoryRequestSchema.parse({ ...valid, name: '  Café  ' });
    expect(result.name).toBe('Café');
  });
});

describe('categoryNameSchema', () => {
  it('accepts 50 code points and fails on 51', () => {
    expect(categoryNameSchema.safeParse('a'.repeat(50)).success).toBe(true);
    expect(categoryNameSchema.safeParse('a'.repeat(51)).success).toBe(false);
  });

  it('counts an emoji as one code point', () => {
    expect(categoryNameSchema.safeParse('\u{1F436}'.repeat(50)).success).toBe(true);
    expect(categoryNameSchema.safeParse('\u{1F436}'.repeat(51)).success).toBe(false);
  });

  it('fails on empty and whitespace-only names', () => {
    expect(categoryNameSchema.safeParse('').success).toBe(false);
    expect(categoryNameSchema.safeParse('   ').success).toBe(false);
  });

  it.each([
    ['zero-width space', 'Pe\u200Bts'],
    ['zero-width joiner', 'Pe\u200Dts'],
    ['right-to-left override', 'Pe\u202Ets'],
    ['NUL', 'Pe\u0000ts'],
    ['BOM at the edge', '\uFEFFPets'],
    ['tab at the edge', 'Pets\t'],
    ['newline', 'Pe\nts'],
    ['soft hyphen', 'Pe\u00ADts'],
  ])('fails on %s', (_label, value) => {
    expect(categoryNameSchema.safeParse(value).success).toBe(false);
  });

  it('fails on a name made only of invisible characters', () => {
    expect(categoryNameSchema.safeParse('\u200B\u200B').success).toBe(false);
  });

  it('names the name field when it fails inside a body', () => {
    const result = createCategoryRequestSchema.safeParse({ ...valid, name: 'a'.repeat(51) });
    expect(failedPaths(result)).toContain('name');
  });
});

describe('updateCategoryRequestSchema', () => {
  it('accepts any one of name, icon or color', () => {
    expect(updateCategoryRequestSchema.safeParse({ name: 'Pets' }).success).toBe(true);
    expect(updateCategoryRequestSchema.safeParse({ icon: 'car' }).success).toBe(true);
    expect(updateCategoryRequestSchema.safeParse({ color: 'red' }).success).toBe(true);
    expect(
      updateCategoryRequestSchema.safeParse({ name: 'Pets', icon: 'car', color: 'red' }).success,
    ).toBe(true);
  });

  it('fails when no field is sent', () => {
    expect(updateCategoryRequestSchema.safeParse({}).success).toBe(false);
  });

  it('fails when kind is sent', () => {
    const result = updateCategoryRequestSchema.safeParse({ name: 'Pets', kind: 'income' });
    expect(result.success).toBe(false);
    expect(failedPaths(result)).toContain('kind');
  });

  it('fails when parentId is sent', () => {
    const result = updateCategoryRequestSchema.safeParse({ name: 'Pets', parentId: UUID });
    expect(result.success).toBe(false);
    expect(failedPaths(result)).toContain('parentId');
  });

  it('fails on an invalid name, icon or color', () => {
    expect(updateCategoryRequestSchema.safeParse({ name: '' }).success).toBe(false);
    expect(updateCategoryRequestSchema.safeParse({ icon: 'rocket' }).success).toBe(false);
    expect(updateCategoryRequestSchema.safeParse({ color: 'chartreuse' }).success).toBe(false);
  });
});

describe('categoryIdParamsSchema', () => {
  it('accepts a UUID and rejects anything else', () => {
    expect(categoryIdParamsSchema.safeParse({ id: UUID }).success).toBe(true);
    expect(categoryIdParamsSchema.safeParse({ id: '1' }).success).toBe(false);
  });
});

describe('listCategoriesQuerySchema', () => {
  it('applies the defaults', () => {
    expect(listCategoriesQuerySchema.parse({})).toEqual({
      archived: false,
      limit: 100,
      offset: 0,
    });
  });

  it('accepts a limit of 100 and fails on 101 and 0', () => {
    expect(listCategoriesQuerySchema.safeParse({ limit: '100' }).success).toBe(true);
    const over = listCategoriesQuerySchema.safeParse({ limit: '101' });
    expect(over.success).toBe(false);
    expect(failedPaths(over)).toContain('limit');
    expect(listCategoriesQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('fails on a negative or fractional offset', () => {
    expect(listCategoriesQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
    expect(listCategoriesQuerySchema.safeParse({ offset: '1.5' }).success).toBe(false);
    expect(listCategoriesQuerySchema.parse({ offset: '5' }).offset).toBe(5);
  });

  it('fails on blank values', () => {
    for (const key of ['limit', 'offset', 'archived', 'kind']) {
      for (const value of ['', '  ']) {
        const result = listCategoriesQuerySchema.safeParse({ [key]: value });
        expect(result.success, `${key}=${JSON.stringify(value)}`).toBe(false);
      }
    }
  });

  it('parses archived into a boolean', () => {
    expect(listCategoriesQuerySchema.parse({ archived: 'true' }).archived).toBe(true);
    expect(listCategoriesQuerySchema.parse({ archived: 'false' }).archived).toBe(false);
    expect(listCategoriesQuerySchema.safeParse({ archived: 'yes' }).success).toBe(false);
  });

  it('accepts an optional kind and refuses others', () => {
    expect(listCategoriesQuerySchema.parse({ kind: 'income' }).kind).toBe('income');
    expect(listCategoriesQuerySchema.parse({}).kind).toBeUndefined();
    expect(listCategoriesQuerySchema.safeParse({ kind: 'transfer' }).success).toBe(false);
  });
});

describe('response schemas', () => {
  const item = {
    id: UUID,
    kind: 'expense',
    parentId: null,
    key: 'food',
    name: null,
    icon: 'utensils',
    color: 'orange',
    archived: false,
    archivedAt: null,
    createdAt: '2026-10-01T12:00:00.000Z',
  };

  it('accepts a default with a null name and a custom category with a null key', () => {
    expect(categoryResponseSchema.safeParse(item).success).toBe(true);
    expect(
      categoryResponseSchema.safeParse({ ...item, key: null, name: 'Pets', parentId: UUID })
        .success,
    ).toBe(true);
  });

  it('refuses an invalid icon', () => {
    expect(categoryResponseSchema.safeParse({ ...item, icon: 'rocket' }).success).toBe(false);
  });

  it('accepts a list page', () => {
    expect(
      listCategoriesResponseSchema.safeParse({ items: [item], total: 1, limit: 100, offset: 0 })
        .success,
    ).toBe(true);
    expect(
      listCategoriesResponseSchema.safeParse({ items: [], total: 0, limit: 101, offset: 0 })
        .success,
    ).toBe(false);
  });
});
