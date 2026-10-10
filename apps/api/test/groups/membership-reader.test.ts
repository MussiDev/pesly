import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleGroupMembershipReader } from '../../src/groups/infrastructure/db/drizzle-group-membership-reader';
import { DrizzleGroupRepository } from '../../src/groups/infrastructure/db/drizzle-group-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newUserId } from '../movements/db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const create = (repository: DrizzleGroupRepository, creatorUserId: string) =>
  repository.create({ name: 'Casa', defaultRateType: 'mep', creatorUserId, categories: [] });

describe('DrizzleGroupMembershipReader', () => {
  it('returns exactly the groups the user belongs to', async () => {
    const repository = new DrizzleGroupRepository(connection.db);
    const reader = new DrizzleGroupMembershipReader(connection.db);
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const own = await create(repository, ana);
    const other = await create(repository, bea);
    const shared = await create(repository, bea);
    await connection.pool.query('insert into group_members (group_id, user_id) values ($1, $2)', [
      shared.group.id,
      ana,
    ]);

    const ids = await reader.groupIdsOf(ana);

    expect([...ids].sort()).toEqual([own.group.id, shared.group.id].sort());
    expect(ids).not.toContain(other.group.id);
  });

  it('returns an empty list for a user with no groups and for an unknown user (sad path)', async () => {
    const reader = new DrizzleGroupMembershipReader(connection.db);
    const ana = await newUserId(connection.db);

    expect(await reader.groupIdsOf(ana)).toEqual([]);
    expect(await reader.groupIdsOf('00000000-0000-4000-8000-000000000000')).toEqual([]);
  });

  it('does not list a group whose membership became a ghost (sad path)', async () => {
    const repository = new DrizzleGroupRepository(connection.db);
    const reader = new DrizzleGroupMembershipReader(connection.db);
    const ana = await newUserId(connection.db);
    await create(repository, ana);
    await connection.pool.query(
      "update group_members set user_id = null, display_name = 'Former member', role = 'member' where user_id = $1",
      [ana],
    );

    expect(await reader.groupIdsOf(ana)).toEqual([]);
  });
});
