import { describe, expect, it } from 'vitest';
import { categoryRowLabel } from '../src/features/reports/category-names';

const labels = { groupShares: 'Group shares', unnamed: 'Unnamed category' };
const ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';

describe('categoryRowLabel (FR-06)', () => {
  it('a default key is the English name in English (AC-13)', () => {
    expect(categoryRowLabel({ categoryId: ID, name: null, defaultKey: 'food' }, 'en', labels)).toBe(
      'Food',
    );
  });

  it('the same default key is the Spanish catalog name in Spanish (AC-13)', () => {
    const label = categoryRowLabel(
      { categoryId: ID, name: null, defaultKey: 'food' },
      'es',
      labels,
    );
    expect(label).not.toBe('Food');
    expect(label.length).toBeGreaterThan(0);
  });

  it('a user category shows its stored name', () => {
    expect(
      categoryRowLabel({ categoryId: ID, name: 'Vacations', defaultKey: null }, 'en', labels),
    ).toBe('Vacations');
  });

  it('a null category id with no name gives the group-shares label (AC-14)', () => {
    expect(categoryRowLabel({ categoryId: null, name: null, defaultKey: null }, 'en', labels)).toBe(
      'Group shares',
    );
  });

  it('error: an unknown default key falls back to the stored name, then to the generic label', () => {
    expect(
      categoryRowLabel({ categoryId: ID, name: 'Stored', defaultKey: 'no-such-key' }, 'en', labels),
    ).toBe('Stored');
    expect(
      categoryRowLabel({ categoryId: ID, name: null, defaultKey: 'no-such-key' }, 'en', labels),
    ).toBe('Unnamed category');
    expect(categoryRowLabel({ categoryId: ID, name: null, defaultKey: null }, 'es', labels)).toBe(
      'Unnamed category',
    );
  });
});
