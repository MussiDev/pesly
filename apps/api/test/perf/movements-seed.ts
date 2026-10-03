import { randomUUID } from 'node:crypto';
import type pg from 'pg';

/**
 * Shared seed of the movements benchmarks (NFR-03, NFR-06): one user with 100 accounts and
 * 100,000 real movements. Everything is bound as parameters; the rows are produced by
 * `generate_series`, never by a loop of single inserts.
 */

export const ACCOUNTS = 100;
export const MOVEMENTS = 100_000;
export const TAGS = 200;

export interface SeededDataset {
  expenseCategoryId: string;
  incomeCategoryId: string;
  /** A parent expense category that holds no movement itself; its two children do. */
  parentCategoryId: string;
  childCategoryIds: string[];
  /** Name of a seeded tag that is linked to movements. */
  tagName: string;
}

async function insertCategory(
  pool: pg.Pool,
  ownerId: string,
  kind: string,
  parentId: string | null = null,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into categories (owner_id, kind, parent_id, name, icon, color)
     values ($1, $2, $4::uuid, $3, 'utensils', 'red') returning id`,
    [ownerId, kind, `Perf ${kind} ${randomUUID()}`.slice(0, 40), parentId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('The category insert returned no row');
  return row.id;
}

/** Inserts the accounts, two categories and the movements of `ownerId`. Failures are not caught. */
export async function seedDataset(pool: pg.Pool, ownerId: string): Promise<SeededDataset> {
  await pool.query(
    `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available)
     select $1, 'Account ' || n,
            case when n % 10 = 0 then 'credit_card' else 'cash' end,
            case when n % 2 = 0 then 'ARS' else 'USD' end,
            n * 100,
            (n % 4 <> 0 and n % 10 <> 0)
       from generate_series(1, $2::int) as n`,
    [ownerId, ACCOUNTS],
  );
  const expenseCategoryId = await insertCategory(pool, ownerId, 'expense');
  const incomeCategoryId = await insertCategory(pool, ownerId, 'income');
  const parentCategoryId = await insertCategory(pool, ownerId, 'expense');
  const childCategoryIds = [
    await insertCategory(pool, ownerId, 'expense', parentCategoryId),
    await insertCategory(pool, ownerId, 'expense', parentCategoryId),
  ];
  // One movement in ten is a transfer (g % 10 = 3, to the account two ahead: same currency) and
  // one in ten an exchange (g % 10 = 7, to the next account: the other currency). Expenses at
  // g % 10 = 1 and 5 go to the two subcategories of one parent.
  await pool.query(
    `insert into movements (owner_id, type, account_id, category_id, destination_account_id,
                            amount, destination_amount, occurred_at, rate, rate_source)
     select $1,
            case g % 10 when 3 then 'transfer' when 7 then 'exchange'
                 else case when g % 2 = 0 then 'income' else 'expense' end end,
            a.id,
            case when g % 10 in (3, 7) then null
                 when g % 2 = 0 then $4::uuid
                 when g % 10 = 1 then $6::uuid
                 when g % 10 = 5 then $7::uuid
                 else $3::uuid end,
            d.id,
            ((g % 2000) + 1)::bigint * 100,
            case when g % 10 in (3, 7) then ((g % 2000) + 1)::bigint * 100 end,
            now() - make_interval(secs => g),
            case when g % 10 = 3 then null else 14000000 end,
            case g % 10 when 3 then null when 7 then 'implied' else 'manual' end
       from generate_series(1, $2::int) as g
       join (select id, substring(name from 9)::int as n from accounts where owner_id = $1) a
         on a.n = (g % $5::int) + 1
       left join (select id, substring(name from 9)::int as n from accounts where owner_id = $1) d
         on d.n = case g % 10 when 3 then ((g % $5::int) + 2) % $5::int + 1
                              when 7 then ((g % $5::int) + 1) % $5::int + 1 end`,
    [
      ownerId,
      MOVEMENTS,
      expenseCategoryId,
      incomeCategoryId,
      ACCOUNTS,
      childCategoryIds[0],
      childCategoryIds[1],
    ],
  );
  await pool.query(
    `insert into tags (owner_id, name) select $1, 'tag-' || n from generate_series(1, $2::int) as n`,
    [ownerId, TAGS],
  );
  // The movement number g is the rank by date (the newest is 1); every expense or income whose rank
  // is not a multiple of three carries one tag, spread evenly over the 200 tags.
  await pool.query(
    `insert into movement_tags (movement_id, tag_id, owner_id, position)
     select m.id, t.id, $1, 0
       from (select id, type, row_number() over (order by occurred_at desc) as g
               from movements where owner_id = $1) m
       join (select id, row_number() over (order by name) - 1 as k
               from tags where owner_id = $1) t
         on t.k = m.g % $2::int
      where m.g % 3 <> 0 and m.type in ('expense', 'income')`,
    [ownerId, TAGS],
  );
  await pool.query('analyze movements');
  await pool.query('analyze movement_tags');
  await pool.query('analyze tags');
  await pool.query('analyze categories');
  const seeded = await pool.query<{ movements: string; accounts: string }>(
    `select (select count(*) from movements where owner_id = $1) as movements,
            (select count(*) from accounts where owner_id = $1) as accounts`,
    [ownerId],
  );
  const counts = seeded.rows[0];
  if (counts?.movements !== String(MOVEMENTS) || counts.accounts !== String(ACCOUNTS)) {
    throw new Error(`Unexpected seed counts: ${JSON.stringify(counts)}`);
  }
  const tagRow = await pool.query<{ name: string }>(
    `select t.name from tags t join movement_tags mt on mt.tag_id = t.id
      where t.owner_id = $1 group by t.name order by t.name limit 1`,
    [ownerId],
  );
  const tagName = tagRow.rows[0]?.name;
  if (!tagName) throw new Error('The seed linked no tag');
  return { expenseCategoryId, incomeCategoryId, parentCategoryId, childCategoryIds, tagName };
}

/**
 * Movements first (the account foreign key restricts; `movement_tags` cascade from them), then
 * subcategories before their parents (the parent key is `restrict`), accounts and the user
 * (`tags` cascade from the user).
 */
export async function removeDataset(pool: pg.Pool, ownerId: string): Promise<void> {
  await pool.query('delete from movements where owner_id = $1', [ownerId]);
  await pool.query('delete from categories where owner_id = $1 and parent_id is not null', [
    ownerId,
  ]);
  await pool.query('delete from categories where owner_id = $1', [ownerId]);
  await pool.query('delete from accounts where owner_id = $1', [ownerId]);
  await pool.query('delete from users where id = $1', [ownerId]);
}

/** The balance of 'Account n' from the seed formula, computed here and not by SQL. */
export function expectedBalance(n: number): bigint {
  let sum = BigInt(n) * 100n;
  for (let g = 1; g <= MOVEMENTS; g += 1) {
    const amount = BigInt((g % 2000) + 1) * 100n;
    const source = (g % ACCOUNTS) + 1;
    const kind = g % 10;
    const isTransferOrExchange = kind === 3 || kind === 7;
    if (source === n) sum += !isTransferOrExchange && g % 2 === 0 ? amount : -amount;
    // The destination is two accounts ahead for a transfer and one ahead for an exchange.
    const destination = isTransferOrExchange
      ? (((g % ACCOUNTS) + (kind === 3 ? 2 : 1)) % ACCOUNTS) + 1
      : 0;
    if (destination === n) sum += amount;
  }
  return sum;
}
