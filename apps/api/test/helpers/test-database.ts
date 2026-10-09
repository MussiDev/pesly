import pg from 'pg';

const baseTestDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://argent:argent@localhost:5434/argent_test';

/**
 * Test files run in parallel workers, and each worker owns its database (`argent_w1_test`,
 * `argent_w2_test`, ...): the files of one worker run one after another, so the truncate before
 * every test never touches data of a file running elsewhere. Vitest numbers its workers from 1 to
 * `maxWorkers` and reuses the number, so the databases are created once and reused.
 */
function databaseUrlForWorker(url: string, workerId: string | undefined): string {
  if (workerId === undefined || workerId === '') return url;
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, '').replace(/_test$/, '');
  parsed.pathname = `/${name}_w${workerId}_test`;
  return parsed.toString();
}

export const testDatabaseUrl = databaseUrlForWorker(
  baseTestDatabaseUrl,
  process.env.VITEST_POOL_ID,
);

export function assertIsTestDatabase(url: string): string {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to use "${name}" as test database: its name must end in _test`);
  }
  return name;
}

/** Creates the database of `url` if it does not exist yet, connecting to the `postgres` database. */
export async function ensureDatabase(url: string): Promise<void> {
  const name = new URL(url).pathname.replace(/^\//, '');
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const existing = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (existing.rowCount === 0) {
      await client.query(`create database ${pg.escapeIdentifier(name)}`);
    }
  } finally {
    await client.end();
  }
}

/** Creates the test database if it does not exist yet. */
export async function ensureTestDatabase(url: string): Promise<void> {
  assertIsTestDatabase(url);
  await ensureDatabase(url);
}

/** Empties every application table in the public schema; drizzle's own table lives elsewhere. */
export async function truncateAllTables(pool: pg.Pool): Promise<void> {
  const result = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  if (result.rows.length === 0) return;
  const tables = result.rows.map((row) => `public.${pg.escapeIdentifier(row.tablename)}`);
  await pool.query(`truncate table ${tables.join(', ')} restart identity cascade`);
}
