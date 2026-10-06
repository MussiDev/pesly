import { describe, expect, it } from 'vitest';
import { failureMessageKey } from '../src/features/movements/sync-failure';

describe('failureMessageKey', () => {
  it('says an edit answered not found was deleted on another device (AC-05)', () => {
    expect(failureMessageKey({ operation: 'update', code: 'NOT_FOUND' })).toBe('deletedElsewhere');
  });

  it('uses the existing message of a known API code (AC-05)', () => {
    expect(failureMessageKey({ operation: 'update', code: 'ACCOUNT_ARCHIVED' })).toBe(
      'accountArchived',
    );
    expect(failureMessageKey({ operation: 'create', code: 'CATEGORY_ARCHIVED' })).toBe(
      'categoryArchived',
    );
  });

  it('answers the generic message for a not-found create, an unknown code or a prototype key (invalid input)', () => {
    expect(failureMessageKey({ operation: 'create', code: 'NOT_FOUND' })).toBe('unexpected');
    expect(failureMessageKey({ operation: 'delete', code: 'SOMETHING_NEW' })).toBe('unexpected');
    expect(failureMessageKey({ operation: 'update', code: 'toString' })).toBe('unexpected');
  });
});
