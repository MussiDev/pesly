import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@pesly/shared';
import { SuggestTags } from '../../src/movements/application/suggest-tags';
import { InMemoryTagRepository, readScopeFor } from './fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

let tags: InMemoryTagRepository;
let suggest: SuggestTags;

beforeEach(() => {
  tags = new InMemoryTagRepository();
  suggest = new SuggestTags({ tags });
});

describe('SuggestTags', () => {
  it('passes the scope, prefix and limit to the port and returns its answer', async () => {
    tags.seed(ALICE, 'Viaje', 'vianda', 'otro');
    const scope = await readScopeFor(ALICE);

    const result = await suggest.execute(scope, { prefix: 'vi', limit: 10 });

    expect(result).toEqual(['Viaje', 'vianda']);
    expect(tags.calls).toEqual([{ scope, prefix: 'vi', limit: 10 }]);
  });

  it('accepts the limits 1 and 20', async () => {
    const scope = await readScopeFor(ALICE);
    await expect(suggest.execute(scope, { prefix: 'a', limit: 1 })).resolves.toEqual([]);
    await expect(suggest.execute(scope, { prefix: 'a', limit: 20 })).resolves.toEqual([]);
  });

  it('answers VALIDATION_FAILED for a limit of 0, 21, a fraction, and never calls the port', async () => {
    const scope = await readScopeFor(ALICE);
    for (const limit of [0, 21, -1, 1.5, Number.NaN]) {
      const attempt = suggest.execute(scope, { prefix: 'a', limit });
      await expect(attempt).rejects.toBeInstanceOf(AppError);
      await expect(attempt).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(tags.calls).toHaveLength(0);
  });

  it('propagates a repository failure unchanged', async () => {
    const failure = new Error('db down');
    tags.suggestError = failure;
    await expect(
      suggest.execute(await readScopeFor(ALICE), { prefix: 'a', limit: 5 }),
    ).rejects.toBe(failure);
  });

  it("reaches the port with the scope of another user, never the caller's", async () => {
    tags.seed(ALICE, 'alice-tag');
    tags.seed(BOB, 'bob-tag');
    const bobScope = await readScopeFor(BOB);

    const result = await suggest.execute(bobScope, { prefix: '', limit: 10 });

    expect(result).toEqual(['bob-tag']);
    expect(tags.calls[0]?.scope.userId).toBe(BOB);
  });
});
