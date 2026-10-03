import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleTagRepository } from '../../src/movements/infrastructure/db/drizzle-tag-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newTag, newUserId, readScope } from './db-fixtures';

let connection: DatabaseConnection;
let repository: DrizzleTagRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleTagRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

async function seeded(names: string[]): Promise<string> {
  const ownerId = await newUserId(connection.db);
  for (const name of names) await newTag(connection.pool, ownerId, name);
  return ownerId;
}

async function suggest(ownerId: string, prefix: string, limit = 20): Promise<string[]> {
  return repository.suggest(await readScope(ownerId), prefix, limit);
}

describe('DrizzleTagRepository.suggest', () => {
  it('matches the first characters case-insensitively, orders alphabetically and respects the limit', async () => {
    const ownerId = await seeded(['Viaje', 'vino', 'VIDEO', 'casa', 'avion vi']);

    expect(await suggest(ownerId, 'vi')).toEqual(['Viaje', 'VIDEO', 'vino']);
    expect(await suggest(ownerId, 'VI')).toEqual(['Viaje', 'VIDEO', 'vino']);
    expect(await suggest(ownerId, 'vi', 2)).toEqual(['Viaje', 'VIDEO']);
    expect(await suggest(ownerId, 'zzz')).toEqual([]);
  });

  it('treats %, _ and backslash in the prefix as literal characters', async () => {
    const ownerId = await seeded(['100%', '100x', 'a_b', 'axb', 'back\\slash', 'backxslash']);

    expect(await suggest(ownerId, '100%')).toEqual(['100%']);
    expect(await suggest(ownerId, '%')).toEqual([]);
    expect(await suggest(ownerId, 'a_')).toEqual(['a_b']);
    expect(await suggest(ownerId, '_')).toEqual([]);
    expect(await suggest(ownerId, 'back\\')).toEqual(['back\\slash']);
    expect(await suggest(ownerId, '\\')).toEqual([]);
  });

  it('suggests a literal wildcard prefix that starts a name', async () => {
    const ownerId = await seeded(['%off', '_x', '\\y', 'plain']);

    expect(await suggest(ownerId, '%')).toEqual(['%off']);
    expect(await suggest(ownerId, '_')).toEqual(['_x']);
    expect(await suggest(ownerId, '\\')).toEqual(['\\y']);
  });

  it("never returns another user's tags", async () => {
    const mine = await seeded(['viaje']);
    const theirs = await seeded(['vino', 'video']);

    expect(await suggest(mine, 'vi')).toEqual(['viaje']);
    expect(await suggest(theirs, 'vi')).toEqual(['video', 'vino']);
    expect(await suggest(await newUserId(connection.db), 'vi')).toEqual([]);
  });
});
