import { createRequire } from 'node:module';

/**
 * Direct access to the e2e database: to reset the rate-limit counters between tests (every test
 * registers from the same IP, and the API allows 5 registrations per IP per hour) and to inspect
 * session state that no API answer exposes.
 */
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://argent:argent@localhost:5434/argent_e2e';

interface PgClient {
  connect(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

interface PgModule {
  Client: new (options: { connectionString: string }) => PgClient;
}

// `pg` is a dependency of the API, which owns the database; it is loaded from there instead of
// adding a second copy to the web app.
const requireFromApi = createRequire(new URL('../../../api/package.json', import.meta.url));
const pg = requireFromApi('pg') as PgModule;

export async function withE2eDatabase<T>(work: (client: PgClient) => Promise<T>): Promise<T> {
  const name = new URL(E2E_DATABASE_URL).pathname.replace(/^\//, '');
  if (!name.endsWith('_e2e')) throw new Error(`Refusing to use "${name}": not an e2e database`);
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function resetAttemptLimits(): Promise<void> {
  await withE2eDatabase((client) => client.query('delete from auth_attempts'));
}

/**
 * Makes the worker's crypto price refresh due. At start-up the worker finds no crypto holding and
 * rests for an hour, so a flow that adds the first one would otherwise wait that long. It only
 * advances a row that is not due yet, so it cannot clobber a lease the worker holds; the minute
 * back absorbs the difference between this clock and the worker's.
 */
export async function makeCryptoPriceRefreshDue(): Promise<void> {
  await withE2eDatabase((client) =>
    client.query(
      `insert into crypto_price_sync (id, next_attempt_at)
       values (1, now() - interval '1 minute')
       on conflict (id) do update set next_attempt_at = now() - interval '1 minute'
         where crypto_price_sync.next_attempt_at > now()`,
    ),
  );
}

/**
 * Sessions of the user that are still usable. A detected refresh-token reuse revokes the whole
 * family, which leaves none.
 */
export async function liveSessionCount(email: string): Promise<number> {
  const { rows } = await withE2eDatabase((client) =>
    client.query(
      `select count(*)::int as live
         from sessions s join users u on u.id = s.user_id
        where u.email = $1 and s.revoked_at is null`,
      [email],
    ),
  );
  return Number(rows[0]?.live ?? 0);
}

export interface AccountRecord {
  users: number;
  googleIdentities: number;
  hasPassword: boolean;
  emailVerified: boolean;
  /** Verification emails ever queued for the address. */
  verificationEmails: number;
}

/** What the database holds for `email`: whether an account exists, and how Google is linked. */
export async function accountRecord(email: string): Promise<AccountRecord> {
  const { rows } = await withE2eDatabase((client) =>
    client.query(
      `select (select count(*)::int from users where email = $1) as users,
              (select count(*)::int
                 from user_identities i join users u on u.id = i.user_id
                where u.email = $1 and i.provider = 'google') as google_identities,
              coalesce((select password_hash is not null from users where email = $1), false)
                as has_password,
              coalesce((select email_verified_at is not null from users where email = $1), false)
                as email_verified,
              (select count(*)::int from email_outbox
                where to_email = $1 and kind = 'verification') as verification_emails`,
      [email],
    ),
  );
  const row = rows[0] ?? {};
  return {
    users: Number(row.users ?? 0),
    googleIdentities: Number(row.google_identities ?? 0),
    hasPassword: row.has_password === true,
    emailVerified: row.email_verified === true,
    verificationEmails: Number(row.verification_emails ?? 0),
  };
}

interface StoredRateRow {
  rateType: unknown;
  buy: unknown;
  sell: unknown;
  providerUpdatedAt: unknown;
  fetchedAt: unknown;
}

async function snapshotRates(client: PgClient): Promise<StoredRateRow[]> {
  const { rows } = await client.query(
    `select rate_type as "rateType", buy::text as buy, sell::text as sell,
            provider_updated_at as "providerUpdatedAt", fetched_at as "fetchedAt"
       from exchange_rates`,
  );
  if (rows.length === 0) throw new Error('The e2e worker has not stored any rate yet');
  return rows as unknown as StoredRateRow[];
}

async function restoreRates(client: PgClient, rows: StoredRateRow[]): Promise<void> {
  for (const row of rows) {
    await client.query(
      `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
       values ($1, $2::bigint, $3::bigint, $4, $5)
       on conflict (rate_type) do update
         set buy = excluded.buy, sell = excluded.sell,
             provider_updated_at = excluded.provider_updated_at, fetched_at = excluded.fetched_at`,
      [row.rateType, row.buy, row.sell, row.providerUpdatedAt, row.fetchedAt],
    );
  }
}

/**
 * Runs `work` with no stored exchange rate (the worker's next refresh is an hour away), then puts
 * the rows back so the other flows still find them.
 */
export async function withoutStoredRates<T>(work: () => Promise<T>): Promise<T> {
  const saved = await withE2eDatabase(async (client) => {
    const rows = await snapshotRates(client);
    await client.query('delete from exchange_rates');
    return rows;
  });
  try {
    return await work();
  } finally {
    await withE2eDatabase((client) => restoreRates(client, saved));
  }
}

/**
 * Runs `work` with every stored rate fetched exactly `hours` hours ago (absolute, so the age does not
 * depend on how old the rates already were), then restores the original `fetched_at` values.
 */
export async function withAgedRates<T>(hours: number, work: () => Promise<T>): Promise<T> {
  const saved = await withE2eDatabase(async (client) => {
    const rows = await snapshotRates(client);
    await client.query(
      `update exchange_rates set fetched_at = now() - make_interval(hours => $1)`,
      [hours],
    );
    return rows;
  });
  try {
    return await work();
  } finally {
    await withE2eDatabase((client) => restoreRates(client, saved));
  }
}

export interface StoredMovement {
  type: string;
  amount: string;
  /** `null` for a transfer. */
  rate: string | null;
  /** `null` for a transfer; `implied` for an exchange. */
  rateSource: string | null;
  /** Transfers and exchanges only. */
  destinationAccountName: string | null;
  /** Exchanges only: the amount that entered the destination account. */
  destinationAmount: string | null;
}

function nullableText(value: unknown): string | null {
  // Every selected column is text in SQL, so anything else is a SQL null.
  return typeof value === 'string' ? value : null;
}

/** The movements saved for `email`, oldest first, with the rate frozen on each. */
export async function movementsOf(email: string): Promise<StoredMovement[]> {
  const { rows } = await withE2eDatabase((client) =>
    client.query(
      `select m.type, m.amount::text as amount, m.rate::text as rate, m.rate_source as rate_source,
              d.name as destination_account_name,
              m.destination_amount::text as destination_amount
         from movements m
         join users u on u.id = m.owner_id
         left join accounts d on d.id = m.destination_account_id
        where u.email = $1
        order by m.created_at, m.id`,
      [email],
    ),
  );
  return rows.map((row) => ({
    type: String(row.type),
    amount: String(row.amount),
    rate: nullableText(row.rate),
    rateSource: nullableText(row.rate_source),
    destinationAccountName: nullableText(row.destination_account_name),
    destinationAmount: nullableText(row.destination_amount),
  }));
}

/** The tag names stored for `email`, sorted: one entry per distinct tag of that user. */
export async function tagsOf(email: string): Promise<string[]> {
  const { rows } = await withE2eDatabase((client) =>
    client.query(
      `select t.name from tags t join users u on u.id = t.owner_id
        where u.email = $1
        order by t.name`,
      [email],
    ),
  );
  return rows.map((row) => String(row.name));
}

/** The account and category ids of the oldest movement of `email`. */
export async function movementIdsOf(
  email: string,
): Promise<{ accountId: string; categoryId: string }> {
  const { rows } = await withE2eDatabase((client) =>
    client.query(
      `select m.account_id, m.category_id
         from movements m join users u on u.id = m.owner_id
        where u.email = $1
        order by m.created_at, m.id
        limit 1`,
      [email],
    ),
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`No movement stored for ${email}`);
  return { accountId: String(row.account_id), categoryId: String(row.category_id) };
}

/**
 * Copies the oldest movement of `email` `count` times, each one an hour older than the last, so a
 * list longer than the offline copy exists without a hundred trips through the form. The user must
 * already have one movement; nothing but the email and the count reaches the database.
 */
export async function seedMovements(email: string, count: number): Promise<void> {
  if (!Number.isInteger(count) || count <= 0) throw new Error(`Invalid movement count: ${count}`);
  const inserted = await withE2eDatabase((client) =>
    client.query(
      `with source as (
         select m.* from movements m join users u on u.id = m.owner_id
          where u.email = $1 order by m.occurred_at limit 1
       )
       insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate,
                              rate_source, rate_type)
       select s.owner_id, s.type, s.account_id, s.category_id, s.amount,
              s.occurred_at - make_interval(hours => g), s.rate, s.rate_source, s.rate_type
         from source s cross join generate_series(1, $2::int) as g
       returning id`,
      [email, count],
    ),
  );
  if (inserted.rows.length !== count) throw new Error(`Seeded ${inserted.rows.length} of ${count}`);
}

/** The ids of every movement stored for `email`, sorted. */
export async function movementRowIds(email: string): Promise<string[]> {
  const { rows } = await withE2eDatabase((client) =>
    client.query(
      `select m.id::text as id from movements m join users u on u.id = m.owner_id
        where u.email = $1
        order by m.id`,
      [email],
    ),
  );
  return rows.map((row) => String(row.id));
}

/** The amount stored for one movement, or `null` once it is gone. */
export async function movementAmount(id: string): Promise<string | null> {
  const { rows } = await withE2eDatabase((client) =>
    client.query('select amount::text as amount from movements where id = $1', [id]),
  );
  const row = rows[0];
  return row === undefined ? null : String(row.amount);
}

/** Archives the account of `email` named `name`, as if done on another device. */
export async function archiveAccount(email: string, name: string): Promise<void> {
  const result = await withE2eDatabase((client) =>
    client.query(
      `update accounts a set archived_at = now()
         from users u
        where u.id = a.owner_id and u.email = $1 and a.name = $2
       returning a.id`,
      [email, name],
    ),
  );
  if (result.rows.length !== 1) throw new Error(`No account named ${name} for ${email}`);
}

/**
 * Closes the oldest statement of the card named `cardName` of `email` by moving its dates into the
 * past, because a statement only closes as days pass and a flow cannot wait for them.
 */
export async function closeFirstStatement(email: string, cardName: string): Promise<void> {
  const result = await withE2eDatabase((client) =>
    client.query(
      `update credit_card_statements s
          set closing_date = current_date - 10, due_date = current_date - 3
         from credit_cards c join users u on u.id = c.owner_id
        where s.card_id = c.id and u.email = $1 and c.name = $2
          and s.id = (select id from credit_card_statements
                       where card_id = c.id order by closing_date limit 1)
       returning s.id`,
      [email, cardName],
    ),
  );
  if (result.rows.length !== 1) throw new Error(`No statement of ${cardName} for ${email}`);
  // A purchase belongs to the first statement whose closing date is on or after its day, so the
  // purchases of the card move back with the dates; otherwise they stay in the next statement.
  await withE2eDatabase((client) =>
    client.query(
      `update movements m
          set occurred_at = m.occurred_at - interval '15 days'
         from credit_cards c join users u on u.id = c.owner_id
        where u.email = $1 and c.name = $2 and m.owner_id = u.id
          and m.account_id in (c.ars_account_id, c.usd_account_id)
          and m.type = 'expense'`,
      [email, cardName],
    ),
  );
}

/**
 * Moves the automatic debit links of the card named `cardName` of `email` 30 days into the past, so
 * the statement made due by `closeFirstStatement` falls after the link (a link only covers
 * statements due on or after the day it was made).
 */
export async function backdateDebitLinks(email: string, cardName: string): Promise<void> {
  const result = await withE2eDatabase((client) =>
    client.query(
      `update credit_cards c
          set debit_ars_linked_on = case when c.debit_ars_account_id is null
                                         then null else current_date - 30 end,
              debit_usd_linked_on = case when c.debit_usd_account_id is null
                                         then null else current_date - 30 end
         from users u
        where u.id = c.owner_id and u.email = $1 and c.name = $2
       returning c.id`,
      [email, cardName],
    ),
  );
  if (result.rows.length !== 1) throw new Error(`No card named ${cardName} for ${email}`);
}

export interface AutomaticDebitRow {
  period: string;
  currency: string;
  status: string;
  reason: string | null;
  /** The amount of the recorded transfer, in minor units; `null` when nothing was recorded. */
  amount: string | null;
}

/** The claim rows the automatic debit job left for the card named `cardName` of `email`. */
export async function automaticDebitRows(
  email: string,
  cardName: string,
): Promise<AutomaticDebitRow[]> {
  const { rows } = await withE2eDatabase((client) =>
    client.query(
      `select d.period, d.currency, d.status, d.reason, m.amount::text as amount
         from card_automatic_debits d
         join credit_cards c on c.id = d.card_id
         join users u on u.id = c.owner_id
         left join movements m on m.id = d.movement_id
        where u.email = $1 and c.name = $2
        order by d.period, d.currency`,
      [email, cardName],
    ),
  );
  return rows.map((row) => ({
    period: String(row.period),
    currency: String(row.currency),
    status: String(row.status),
    reason: nullableText(row.reason),
    amount: nullableText(row.amount),
  }));
}
