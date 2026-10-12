import { AUTOMATIC_SEND_CATEGORY_KEY, DEFAULT_CATEGORIES } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleGroupRepository } from '../../src/groups/infrastructure/db/drizzle-group-repository';
import { ensureDefaultCategory } from '../../src/groups/infrastructure/db/ensure-default-category';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newUserId } from '../movements/db-fixtures';

let connection: DatabaseConnection;
let groupsRepo: DrizzleGroupRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  groupsRepo = new DrizzleGroupRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const DEFAULT = DEFAULT_CATEGORIES.find((c) => c.key === AUTOMATIC_SEND_CATEGORY_KEY);

async function newGroup(withOther = false): Promise<string> {
  const owner = await newUserId(connection.db);
  const { group } = await groupsRepo.create({
    name: 'Casa',
    defaultRateType: 'mep',
    creatorUserId: owner,
    categories:
      withOther && DEFAULT
        ? [{ defaultKey: DEFAULT.key, name: null, icon: DEFAULT.icon, color: DEFAULT.color }]
        : [],
  });
  return group.id;
}

interface Row {
  id: string;
  name: string | null;
  icon: string;
  color: string;
  archived_at: Date | null;
  updated_at: Date;
}

async function rows(groupId: string): Promise<Row[]> {
  const result = await connection.pool.query<Row>(
    'select id, name, icon, color, archived_at, updated_at from group_categories where group_id = $1 and default_key = $2',
    [groupId, AUTOMATIC_SEND_CATEGORY_KEY],
  );
  return result.rows;
}

const resolve = (groupId: string) =>
  connection.db.transaction((tx) =>
    ensureDefaultCategory(tx, groupId, AUTOMATIC_SEND_CATEGORY_KEY),
  );

describe('ensureDefaultCategory', () => {
  it('creates the row with the default key, icon, color and a null name', async () => {
    const groupId = await newGroup();
    const result = await resolve(groupId);
    const found = await rows(groupId);
    expect(result.change).toBe('created');
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe(result.categoryId);
    expect(found[0]?.name).toBeNull();
    expect(found[0]?.icon).toBe('ellipsis');
    expect(found[0]?.color).toBe('slate');
  });

  it('restores an archived row without creating a second one', async () => {
    const groupId = await newGroup(true);
    await connection.pool.query(
      'update group_categories set archived_at = now() where group_id = $1 and default_key = $2',
      [groupId, AUTOMATIC_SEND_CATEGORY_KEY],
    );
    const result = await resolve(groupId);
    const found = await rows(groupId);
    expect(result.change).toBe('restored');
    expect(found).toHaveLength(1);
    expect(found[0]?.archived_at).toBeNull();
    expect(found[0]?.id).toBe(result.categoryId);
  });

  it('returns an active row with a null change and writes nothing', async () => {
    const groupId = await newGroup(true);
    const before = await rows(groupId);
    const result = await resolve(groupId);
    const after = await rows(groupId);
    expect(result.change).toBeNull();
    expect(result.categoryId).toBe(before[0]?.id);
    expect(after[0]?.updated_at).toEqual(before[0]?.updated_at);
  });

  it('resolves 20 concurrent transactions to one created row', async () => {
    const groupId = await newGroup();
    const results = await Promise.all(Array.from({ length: 20 }, () => resolve(groupId)));
    const found = await rows(groupId);
    expect(found).toHaveLength(1);
    expect(new Set(results.map((r) => r.categoryId))).toEqual(new Set([found[0]?.id]));
    expect(results.filter((r) => r.change === 'created')).toHaveLength(1);
  });

  it('restores an archived row exactly once under 20 concurrent transactions', async () => {
    const groupId = await newGroup(true);
    await connection.pool.query(
      'update group_categories set archived_at = now() where group_id = $1 and default_key = $2',
      [groupId, AUTOMATIC_SEND_CATEGORY_KEY],
    );
    const results = await Promise.all(Array.from({ length: 20 }, () => resolve(groupId)));
    const found = await rows(groupId);
    expect(found).toHaveLength(1);
    expect(found[0]?.archived_at).toBeNull();
    expect(results.filter((r) => r.change === 'restored')).toHaveLength(1);
  });

  it('leaves no row when the transaction rolls back after the call', async () => {
    const groupId = await newGroup();
    await expect(
      connection.db.transaction(async (tx) => {
        await ensureDefaultCategory(tx, groupId, AUTOMATIC_SEND_CATEGORY_KEY);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await rows(groupId)).toHaveLength(0);
  });

  it('returns a renamed default as is', async () => {
    const groupId = await newGroup(true);
    await connection.pool.query(
      "update group_categories set name = 'Varios' where group_id = $1 and default_key = $2",
      [groupId, AUTOMATIC_SEND_CATEGORY_KEY],
    );
    const result = await resolve(groupId);
    const found = await rows(groupId);
    expect(result.change).toBeNull();
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe('Varios');
  });

  it('throws for a key that is not a top-level expense default', async () => {
    const groupId = await newGroup();
    const nested = DEFAULT_CATEGORIES.find((c) => c.parentKey !== null);
    const income = DEFAULT_CATEGORIES.find((c) => c.parentKey === null && c.kind === 'income');
    await expect(
      connection.db.transaction((tx) => ensureDefaultCategory(tx, groupId, 'nope')),
    ).rejects.toThrow();
    await expect(
      connection.db.transaction((tx) => ensureDefaultCategory(tx, groupId, nested?.key ?? 'x')),
    ).rejects.toThrow();
    await expect(
      connection.db.transaction((tx) => ensureDefaultCategory(tx, groupId, income?.key ?? 'x')),
    ).rejects.toThrow();
  });

  it('never touches another group and sets no name', async () => {
    const mine = await newGroup();
    const other = await newGroup();
    await resolve(mine);
    expect(await rows(other)).toHaveLength(0);
    expect((await rows(mine))[0]?.name).toBeNull();
  });
});
