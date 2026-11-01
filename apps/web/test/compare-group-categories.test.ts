import { DEFAULT_CATEGORIES } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import { compareGroupCategories } from '../src/features/categories/category-display';

const [first, second] = DEFAULT_CATEGORIES.map((entry) => entry.key);

describe('compareGroupCategories', () => {
  it('orders defaults by the catalog and puts the group’s own categories after them', () => {
    const list = [
      { id: 'own', defaultKey: null },
      { id: 'b', defaultKey: second ?? null },
      { id: 'a', defaultKey: first ?? null },
    ];
    expect([...list].sort(compareGroupCategories).map((c) => c.id)).toEqual(['a', 'b', 'own']);
  });

  it('error: an unknown default key sorts like a custom category, without failing', () => {
    const list = [
      { id: 'unknown', defaultKey: 'not.a.key' },
      { id: 'a', defaultKey: first ?? null },
      { id: 'own', defaultKey: null },
    ];
    expect([...list].sort(compareGroupCategories).map((c) => c.id)).toEqual([
      'a',
      'unknown',
      'own',
    ]);
  });
});
