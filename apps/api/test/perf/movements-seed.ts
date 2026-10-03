import { randomUUID } from 'node:crypto';
import type pg from 'pg';

/**
 * Shared seed of the movements benchmarks (NFR-03, NFR-06): one user with 100 accounts and
 * 100,000 real movements. Everything is bound as parameters; the rows are produced by
 * `generate_series`, never by a loop of single inserts.
 */

export const ACCOUNTS = 100;
export const MOVEMENTS = 100_000;

export interface SeededDataset {
  expenseCategoryId: string;
  incomeCategoryId: string;
}

async function insertCategory(pool: pg.Pool, ownerId: string, kind: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into categories (owner_id, kind, name, icon, color)
     values ($1, $2, $3, 'utensils', 'red') returning id`,
    [ownerId, kind, `Perf ${kind} ${randomUUID()}`.slice(0, 40)],
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
  // One movement in ten is a transfer (g % 10 = 3, to the account two ahead: same currency) and
  // one in ten an exchange (g % 10 = 7, to the next account: the other currency).
  await pool.query(
    `insert into movements (owner_id, type, account_id, category_id, destination_account_id,
                            amount, destination_amount, occurred_at, rate, rate_source)
     select $1,
            case g % 10 when 3 then 'transfer' when 7 then 'exchange'
                 else case when g % 2 = 0 then 'income' else 'expense' end end,
            a.id,
            case when g % 10 in (3, 7) then null
                 when g % 2 = 0 then $4::uuid else $3::uuid end,
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
    [ownerId, MOVEMENTS, expenseCategoryId, incomeCategoryId, ACCOUNTS],
  );
  await pool.query('analyze movements');
  const seeded = await pool.query<{ movements: string; accounts: string }>(
    `select (select count(*) from movements where owner_id = $1) as movements,
            (select count(*) from accounts where owner_id = $1) as accounts`,
    [ownerId],
  );
  const counts = seeded.rows[0];
  if (counts?.movements !== String(MOVEMENTS) || counts.accounts !== String(ACCOUNTS)) {
    throw new Error(`Unexpected seed counts: ${JSON.stringify(counts)}`);
  }
  return { expenseCategoryId, incomeCategoryId };
}

/** Movements first (the account foreign key restricts), then categories, accounts and the user. */
export async function removeDataset(pool: pg.Pool, ownerId: string): Promise<void> {
  await pool.query('delete from movements where owner_id = $1', [ownerId]);
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
