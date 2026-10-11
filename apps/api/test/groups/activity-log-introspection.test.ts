import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

async function column(
  name: string,
): Promise<{ data_type: string; is_nullable: string } | undefined> {
  const result = await connection.pool.query<{ data_type: string; is_nullable: string }>(
    `select data_type, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'group_activity_log' and column_name = $1`,
    [name],
  );
  return result.rows[0];
}

async function checkDefinition(name: string): Promise<string | undefined> {
  const result = await connection.pool.query<{ def: string }>(
    'select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1',
    [name],
  );
  return result.rows[0]?.def;
}

describe('group activity log schema introspection', () => {
  it('stores before and after as nullable jsonb (NFR-02)', async () => {
    expect(await column('before')).toEqual({ data_type: 'jsonb', is_nullable: 'YES' });
    expect(await column('after')).toEqual({ data_type: 'jsonb', is_nullable: 'YES' });
  });

  it('has no real, double, numeric or money column (NFR-02)', async () => {
    const result = await connection.pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'group_activity_log'
          and data_type in ('real', 'double precision', 'numeric', 'money')`,
    );
    expect(result.rows).toEqual([]);
  });

  it('has the action check with the six actions and the snapshot check', async () => {
    const action = (await checkDefinition('group_activity_log_action_check')) ?? '';
    for (const name of [
      'expense_created',
      'expense_updated',
      'expense_deleted',
      'settlement_created',
      'settlement_updated',
      'settlement_deleted',
    ]) {
      expect(action).toContain(name);
    }
    const snapshots = (await checkDefinition('group_activity_log_snapshots_check')) ?? '';
    expect(snapshots).toContain('before');
    expect(snapshots).toContain('after');
  });

  it('has the immutability trigger before update and before delete, per row (NFR-01)', async () => {
    const result = await connection.pool.query<{ def: string }>(
      `select pg_get_triggerdef(oid) as def from pg_trigger
        where tgname = 'group_activity_log_immutable' and not tgisinternal`,
    );
    expect(result.rows).toHaveLength(1);
    const def = result.rows[0]?.def ?? '';
    expect(def).toMatch(/BEFORE (UPDATE OR DELETE|DELETE OR UPDATE)/);
    expect(def).toContain('FOR EACH ROW');
    expect(def).toContain('group_activity_log');
  });
});
