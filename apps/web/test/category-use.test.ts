// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  rankByUse,
  readCategoryUse,
  recordCategoryUse,
} from '../src/features/movements/category-use';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const categories = [
  { id: 'food', parentId: null },
  { id: 'food.market', parentId: 'food' },
  { id: 'transport', parentId: null },
  { id: 'health', parentId: null },
];

describe('category use', () => {
  it('counts each save per user and ranks the most used first, parents by their children', () => {
    recordCategoryUse('u1', 'health');
    recordCategoryUse('u1', 'food.market');
    recordCategoryUse('u1', 'food.market');
    recordCategoryUse('u2', 'transport');

    expect(readCategoryUse('u1')).toEqual({ health: 1, 'food.market': 2 });
    expect(rankByUse(categories, readCategoryUse('u1')).map((c) => c.id)).toEqual([
      'food',
      'food.market',
      'health',
      'transport',
    ]);
  });

  it('keeps the incoming order for a user with no history', () => {
    expect(rankByUse(categories, readCategoryUse('nobody'))).toEqual(categories);
    expect(readCategoryUse(undefined)).toEqual({});
  });

  it('error: ignores a malformed stored value and blocked storage', () => {
    window.localStorage.setItem('pesly.categoryUse.u1', '[1,2]');
    expect(readCategoryUse('u1')).toEqual({});
    window.localStorage.setItem('pesly.categoryUse.u1', '{"a":"x","b":3}');
    expect(readCategoryUse('u1')).toEqual({ b: 3 });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => {
      recordCategoryUse('u1', 'b');
    }).not.toThrow();
    recordCategoryUse(undefined, 'b');
  });
});
