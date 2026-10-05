import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@pesly/shared';
import { ListTags } from '../../src/movements/application/list-tags';
import { InMemoryTagRepository, readScopeFor } from './fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

let tags: InMemoryTagRepository;
let list: ListTags;

beforeEach(() => {
  tags = new InMemoryTagRepository();
  list = new ListTags({ tags });
});

describe('ListTags', () => {
  it('passes the scope and the page to the port and returns its answer (FR-01)', async () => {
    tags.seed(ALICE, 'viaje', 'Auto', 'casa');
    const scope = await readScopeFor(ALICE);

    const result = await list.execute(scope, { limit: 2, offset: 1 });

    expect(result).toEqual({ items: ['casa', 'viaje'], total: 3 });
    expect(tags.listCalls).toEqual([{ scope, limit: 2, offset: 1 }]);
  });

  it('accepts the limits 1 and 100 and an offset of 0 (FR-01)', async () => {
    const scope = await readScopeFor(ALICE);
    await expect(list.execute(scope, { limit: 1, offset: 0 })).resolves.toEqual({
      items: [],
      total: 0,
    });
    await expect(list.execute(scope, { limit: 100, offset: 0 })).resolves.toEqual({
      items: [],
      total: 0,
    });
  });

  it('rejects a limit of 0 or 101 and a negative offset as invalid, and never calls the port (FR-01)', async () => {
    const scope = await readScopeFor(ALICE);
    const bad = [
      { limit: 0, offset: 0 },
      { limit: 101, offset: 0 },
      { limit: 1.5, offset: 0 },
      { limit: 10, offset: -1 },
      { limit: 10, offset: 0.5 },
      { limit: Number.NaN, offset: 0 },
    ];
    for (const page of bad) {
      const attempt = list.execute(scope, page);
      await expect(attempt).rejects.toBeInstanceOf(AppError);
      await expect(attempt).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(tags.listCalls).toHaveLength(0);
  });

  it('never returns the tags of another user (FR-01)', async () => {
    tags.seed(ALICE, 'mia');
    tags.seed(BOB, 'suya');

    const result = await list.execute(await readScopeFor(ALICE), { limit: 50, offset: 0 });

    expect(result.items).toEqual(['mia']);
  });
});
