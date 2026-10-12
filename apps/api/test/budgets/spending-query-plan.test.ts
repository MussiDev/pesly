import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { monthBounds, previousMonth } from '../../src/budgets/domain/month';
import { DrizzleSpendingReader } from '../../src/budgets/infrastructure/db/drizzle-spending-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newUserId, readScope } from '../movements/db-fixtures';
import { newGroup, newGroupCategory, newMember, statementsOf } from './spending-fixtures';

const ZONE = 'America/Argentina/Buenos_Aires';
const MOVEMENTS = 100_000;
const SEEDING_TIMEOUT_MS = 120_000;

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

function nodesOf(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(nodesOf)];
}

describe('spending query plans (NFR-01)', () => {
  it(
    'serves the personal query from the owner/category/date index and its exclusion from the payer movement index, with no sequential scan of group_expenses',
    async () => {
      const ownerId = await newUserId(connection.db);
      const accountId = await newAccount(connection.pool, ownerId, false, 'ARS');
      await connection.pool.query(
        `insert into categories (owner_id, kind, name, icon, color)
         select $1, 'expense', 'Cat ' || i, 'wallet', 'blue' from generate_series(1, 200) i`,
        [ownerId],
      );
      await connection.pool.query(
        `with cats as (select array_agg(id order by name) as ids from categories where owner_id = $1)
         insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
         select $1, 'expense', $2, cats.ids[(i % 200) + 1], 100 + i,
                '2026-08-01T00:00:00Z'::timestamptz + (i % 90) * interval '1 day', 14000000, 'manual'
           from generate_series(1, ${MOVEMENTS}) i, cats`,
        [ownerId, accountId],
      );
      const groupId = await newGroup(connection.pool);
      const memberId = await newMember(connection.pool, groupId, ownerId);
      const groupCategory = await newGroupCategory(connection.pool, groupId, { name: 'Food' });
      // Half of the group expenses point at one of the owner's movements, the rest at none.
      await connection.pool.query(
        `insert into group_expenses (group_id, payer_member_id, created_by_member_id, amount, currency,
           occurred_at, category_id, description, split_mode, payer_movement_id)
         select $1, $2, $2, 100, 'ARS', '2026-09-15T00:00:00Z', $3, 'Dinner', 'equal', m.id
           from (select id from movements where owner_id = $4 limit 50000) m`,
        [groupId, memberId, groupCategory, ownerId],
      );
      await connection.pool.query(
        `insert into group_expenses (group_id, payer_member_id, created_by_member_id, amount, currency,
           occurred_at, category_id, description, split_mode)
         select $1, $2, $2, 100, 'ARS', '2026-09-15T00:00:00Z', $3, 'Dinner', 'equal'
           from generate_series(1, 50000)`,
        [groupId, memberId, groupCategory],
      );
      await connection.pool.query('analyze movements');
      await connection.pool.query('analyze group_expenses');
      const categories = await connection.pool.query<{ id: string }>(
        'select id from categories where owner_id = $1 order by name limit 1',
        [ownerId],
      );

      const spy = vi.spyOn(connection.pool, 'query');
      await new DrizzleSpendingReader(connection.db).personalSpending(
        await readScope(ownerId),
        {
          current: monthBounds('2026-10', ZONE),
          previous: monthBounds(previousMonth('2026-10'), ZONE),
        },
        categories.rows.map((row) => row.id),
      );
      const [statement] = statementsOf(spy.mock.calls);
      spy.mockRestore();
      expect(statement).toBeDefined();

      const explained = await connection.pool.query<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
        `explain (format json) ${statement?.text ?? ''}`,
        statement?.values ?? [],
      );
      const nodes = nodesOf(explained.rows[0]?.['QUERY PLAN'][0]?.Plan as PlanNode);
      const indexes = nodes.map((node) => node['Index Name']).filter(Boolean);
      const sequentialScans = nodes
        .filter((node) => node['Node Type'] === 'Seq Scan')
        .map((node) => node['Relation Name']);

      expect(indexes).toContain('movements_owner_category_date_idx');
      expect(indexes).toContain('group_expenses_payer_movement_unique');
      expect(sequentialScans).not.toContain('group_expenses');
    },
    SEEDING_TIMEOUT_MS,
  );
});
