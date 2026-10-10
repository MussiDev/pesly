import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eraseUserGroups } from '../../src/groups/infrastructure/db/erase-user-groups';
import { DrizzleGroupRepository } from '../../src/groups/infrastructure/db/drizzle-group-repository';
import { DrizzleUserDeletionRepository } from '../../src/identity/infrastructure/db/drizzle-user-deletion-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { violatedConstraint } from '../../src/shared/db/pg-errors';
import { testDatabaseUrl } from '../helpers/test-database';
import { newUserId } from '../movements/db-fixtures';

let connection: DatabaseConnection;
let repository: DrizzleGroupRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleGroupRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const erase = (
  userId: string,
  steps: ConstructorParameters<typeof DrizzleUserDeletionRepository>[1],
) =>
  new DrizzleUserDeletionRepository(connection.db, steps).erase({ userId, credentialsVersion: 0 });

const createGroup = (creatorUserId: string) =>
  repository.create({ name: 'Casa', defaultRateType: 'mep', creatorUserId, categories: [] });

async function joined(admin: string, user: string): Promise<string> {
  const { group } = await createGroup(admin);
  await connection.pool.query('insert into group_members (group_id, user_id) values ($1, $2)', [
    group.id,
    user,
  ]);
  return group.id;
}

const usersWith = async (id: string): Promise<number> => {
  const result = await connection.pool.query<{ n: string }>(
    'select count(*) as n from users where id = $1',
    [id],
  );
  return Number(result.rows[0]?.n);
};

describe('eraseUserGroups', () => {
  it('deleting an admin account succeeds, leaves a "Former member" ghost and the group readable', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const groupId = await joined(ana, bea);
    const adminRow = await connection.pool.query<{ id: string }>(
      'select id from group_members where group_id = $1 and user_id = $2',
      [groupId, ana],
    );
    const anaMemberId = adminRow.rows[0]?.id ?? '';

    const result = await erase(ana, [eraseUserGroups]);

    expect(result).toBe('erased');
    expect(await usersWith(ana)).toBe(0);
    const ghost = await repository.findMemberById(groupId, anaMemberId);
    expect(ghost).toMatchObject({
      userId: null,
      displayName: 'Former member',
      role: 'member',
    });
    const detail = await repository.getGroup(groupId);
    expect(detail?.members).toHaveLength(2);
    expect(await repository.getSummary(groupId, bea)).toMatchObject({
      role: 'member',
      memberCount: 2,
    });
  });

  it('converts the memberships of every group of the user and leaves the others untouched', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const first = await joined(ana, bea);
    const second = await joined(bea, ana);

    await connection.db.transaction((tx) => eraseUserGroups(tx, ana));

    const rows = await connection.pool.query<{
      user_id: string | null;
      display_name: string | null;
    }>(
      'select user_id, display_name from group_members where group_id = any($1) order by joined_at, id',
      [[first, second]],
    );
    expect(rows.rows.filter((r) => r.display_name === 'Former member')).toHaveLength(2);
    expect(rows.rows.filter((r) => r.user_id === bea)).toHaveLength(2);
    expect(await repository.findMember(first, ana)).toBeNull();
  });

  it('erases a user who belongs to no group (sad path of the empty case)', async () => {
    const ana = await newUserId(connection.db);

    expect(await erase(ana, [eraseUserGroups])).toBe('erased');
    expect(await usersWith(ana)).toBe(0);
  });

  it('is needed: without the step the restricting key refuses the erasure and nothing changes (sad path)', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    await joined(ana, bea);

    const error: unknown = await erase(ana, []).catch((e: unknown) => e);

    expect(violatedConstraint(error, '23503')).toMatch(/group_members/);
    expect(await usersWith(ana)).toBe(1);
  });
});
