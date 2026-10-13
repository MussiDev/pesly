import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { monthBounds, previousMonth } from '../../src/budgets/domain/month';
import { DrizzleSpendingReader } from '../../src/budgets/infrastructure/db/drizzle-spending-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory, newUserId, readScope } from '../movements/db-fixtures';
import { newCard } from '../reports/flow-fixtures';
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

  it(
    'serves the card purchase and installment reads from indexes, with no sequential scan of movements, installments or the statements',
    async () => {
      const ownerId = await newUserId(connection.db);
      const noiseId = await newUserId(connection.db);
      const mine = await seedCardOwner(ownerId, 10_000);
      await seedCardOwner(noiseId, MOVEMENTS);
      // Many other cards with their statements, so the statement lookup is worth an index.
      for (let index = 0; index < 150; index += 1) await seedCardOwner(noiseId, 0);
      await connection.pool.query('analyze movements');
      await connection.pool.query('analyze credit_card_statements');
      await connection.pool.query('analyze installment_purchases');
      await connection.pool.query('analyze installments');

      const reader = new DrizzleSpendingReader(connection.db);
      const scope = await readScope(ownerId);
      const window = {
        current: monthBounds('2026-10', ZONE),
        previous: monthBounds(previousMonth('2026-10'), ZONE),
      };
      const spy = vi.spyOn(connection.pool, 'query');
      await reader.cardPurchaseSpending(scope, window, [mine.categoryId], ZONE);
      await reader.installmentSpending(scope, window, [mine.categoryId]);
      const statements = statementsOf(spy.mock.calls);
      spy.mockRestore();
      expect(statements).toHaveLength(2);

      for (const statement of statements) {
        const explained = await connection.pool.query<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
          `explain (format json) ${statement.text}`,
          statement.values,
        );
        const nodes = nodesOf(explained.rows[0]?.['QUERY PLAN'][0]?.Plan as PlanNode);
        const sequentialScans = nodes
          .filter((node) => node['Node Type'] === 'Seq Scan')
          .map((node) => node['Relation Name']);

        for (const relation of ['movements', 'installments', 'installment_purchases']) {
          expect(sequentialScans).not.toContain(relation);
        }
        expect(sequentialScans).not.toContain('credit_card_statements');
      }
    },
    SEEDING_TIMEOUT_MS,
  );
});

/** A card of the owner with `count` expenses on its ARS account, stored statements and installments. */
async function seedCardOwner(ownerId: string, count: number): Promise<{ categoryId: string }> {
  const ars = await newAccount(connection.pool, ownerId, false, 'ARS');
  const usd = await newAccount(connection.pool, ownerId, false, 'USD');
  const cardId = await newCard(connection.pool, {
    ownerId,
    arsAccountId: ars,
    usdAccountId: usd,
    closingDay: 24,
    dueDay: 5,
  });
  const categoryId = await newCategory(connection.pool, ownerId, 'expense');
  await connection.pool.query(
    `insert into credit_card_statements (card_id, owner_id, period, closing_date, due_date)
     select $1, $2, to_char(d, 'YYYY-MM'), (d + interval '23 days')::date, (d + interval '1 month 4 days')::date
       from generate_series('2024-01-01'::date, '2026-12-01'::date, interval '1 month') d`,
    [cardId, ownerId],
  );
  await connection.pool.query(
    `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
     select $1, 'expense', $2, $3, 100 + i,
            '2024-01-01T12:00:00Z'::timestamptz + (i % 1000) * interval '1 day', 14000000, 'manual'
       from generate_series(1, ${count}) i`,
    [ownerId, ars, categoryId],
  );
  await connection.pool.query(
    `insert into installment_purchases (owner_id, card_id, category_id, total_amount, currency, installment_count, purchased_on)
     select $1, $2, $3, 1000, 'ARS', 2, '2026-01-01' from generate_series(1, ${Math.floor(count / 10)})`,
    [ownerId, cardId, categoryId],
  );
  await connection.pool.query(
    `insert into installments (purchase_id, owner_id, number, period, amount)
     select p.id, p.owner_id, n.number, to_char('2026-01-01'::date + (n.number * (row_number() over ()) % 24) * interval '1 month', 'YYYY-MM'), 500
       from installment_purchases p, generate_series(1, 2) n(number) where p.owner_id = $1
        and not exists (select 1 from installments i where i.purchase_id = p.id)`,
    [ownerId],
  );
  return { categoryId };
}
