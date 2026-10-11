import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AutomaticDebitKey,
  AutomaticDebitSettlement,
} from '../../src/credit-cards/application/ports/automatic-debit-log';
import { settledKey } from '../../src/credit-cards/domain/automatic-debit';
import { DrizzleAutomaticDebitLog } from '../../src/credit-cards/infrastructure/db/drizzle-automatic-debit-log';
import { DrizzleAutomaticDebitSource } from '../../src/credit-cards/infrastructure/db/drizzle-automatic-debit-source';
import { DrizzleCreditCardRepository } from '../../src/credit-cards/infrastructure/db/drizzle-credit-card-repository';
import { createAutomaticDebitRecorder } from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newUserId, writeScope } from '../movements/db-fixtures';

let connection: DatabaseConnection;
let cards: DrizzleCreditCardRepository;
let source: DrizzleAutomaticDebitSource;
let log: DrizzleAutomaticDebitLog;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  cards = new DrizzleCreditCardRepository(connection.db);
  source = new DrizzleAutomaticDebitSource(connection.db);
  log = new DrizzleAutomaticDebitLog(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const silent = createLogger({ level: 'silent', destination: { write: () => undefined } });
const linkedOn = '2026-10-01';

async function newCard(ownerId: string, debit: { ARS?: string; USD?: string } = {}) {
  const scope = await writeScope(ownerId);
  const { card } = await cards.create(scope, {
    name: `Visa ${randomUUID().slice(0, 8)}`,
    closingDay: 24,
    dueDay: 5,
    firstStatement: { period: '2026-10', closingDate: '2026-10-24', dueDate: '2026-11-05' },
  });
  if (!debit.ARS && !debit.USD) return card;
  const updated = await cards.updateDebitAccounts(scope, card.id, {
    ARS: debit.ARS ? { accountId: debit.ARS, linkedOn } : null,
    USD: debit.USD ? { accountId: debit.USD, linkedOn } : null,
  });
  if (!updated) throw new Error('The card disappeared');
  return updated;
}

async function readAll(limit: number) {
  const all = [];
  let afterId: string | null = null;
  for (;;) {
    const page: Awaited<ReturnType<typeof source.page>> = await source.page(afterId, limit);
    expect(page.length).toBeLessThanOrEqual(limit);
    all.push(...page);
    const last = page[page.length - 1];
    if (page.length < limit || !last) return all;
    afterId = last.card.id;
  }
}

async function rowsOf(cardId: string) {
  const result = await connection.pool.query<{
    period: string;
    currency: string;
    status: string;
    reason: string | null;
    movement_id: string | null;
  }>(
    'select period, currency, status, reason, movement_id from card_automatic_debits where card_id = $1 order by period, currency',
    [cardId],
  );
  return result.rows;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('DrizzleAutomaticDebitSource', () => {
  it('returns only cards with a debit account, with owner and zone, paged without gaps (FR-02)', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db, { timeZone: 'Asia/Tokyo' });
    const anaArs = await newAccount(connection.pool, ana);
    const anaUsd = await newAccount(connection.pool, ana, false, 'USD');
    const beaArs = await newAccount(connection.pool, bea);
    const withArs = await newCard(ana, { ARS: anaArs });
    const withUsd = await newCard(ana, { USD: anaUsd });
    const beaCard = await newCard(bea, { ARS: beaArs });
    const plain = await newCard(ana);

    const all = await readAll(2);

    const ids = all.map((entry) => entry.card.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    expect(ids).toEqual(expect.arrayContaining([withArs.id, withUsd.id, beaCard.id]));
    expect(ids).not.toContain(plain.id);
    const byId = new Map(all.map((entry) => [entry.card.id, entry]));
    expect(byId.get(withArs.id)).toMatchObject({ ownerId: ana, timeZone: 'America/Cordoba' });
    expect(byId.get(beaCard.id)).toMatchObject({ ownerId: bea, timeZone: 'Asia/Tokyo' });
    expect(byId.get(withArs.id)?.card.debitAccounts.ARS).toEqual({
      accountId: anaArs,
      linkedOn,
    });
    expect(byId.get(withArs.id)?.card.debitAccounts.USD).toBeNull();
    expect(byId.get(withUsd.id)?.card.debitAccounts.ARS).toBeNull();
  });

  it('starts after the given id and honors the limit', async () => {
    const owner = await newUserId(connection.db);
    const created = [];
    for (let i = 0; i < 3; i += 1) {
      const account = await newAccount(connection.pool, owner);
      created.push((await newCard(owner, { ARS: account })).id);
    }
    const sorted = [...created].sort();

    const page = await source.page(sorted[0] ?? null, 1000);

    const ids = page.map((entry) => entry.card.id);
    expect(ids).not.toContain(sorted[0]);
    expect(ids).toEqual(expect.arrayContaining(sorted.slice(1)));
    expect(await source.page(null, 1)).toHaveLength(1);
    expect(await source.page('ffffffff-ffff-4fff-8fff-ffffffffffff', 10)).toEqual([]);
  });

  it('returns no entry once the debit link is cleared, nor for an erased user (AC-04, sad path)', async () => {
    const kept = await newUserId(connection.db);
    const erased = await newUserId(connection.db);
    const keptAccount = await newAccount(connection.pool, kept);
    const erasedAccount = await newAccount(connection.pool, erased);
    const cleared = await newCard(kept, { ARS: keptAccount });
    const gone = await newCard(erased, { ARS: erasedAccount });
    await cards.updateDebitAccounts(await writeScope(kept), cleared.id, { ARS: null, USD: null });
    await connection.pool.query('delete from users where id = $1', [erased]);

    const ids = (await readAll(50)).map((entry) => entry.card.id);

    expect(ids).not.toContain(cleared.id);
    expect(ids).not.toContain(gone.id);
  });
});

describe('DrizzleAutomaticDebitLog', () => {
  async function setup() {
    const ownerId = await newUserId(connection.db);
    const card = await newCard(ownerId);
    const key: AutomaticDebitKey = { cardId: card.id, period: '2026-10', currency: 'ARS' };
    return { ownerId, card, key, scope: await writeScope(ownerId) };
  }
  const recorded = (): AutomaticDebitSettlement => ({
    status: 'recorded',
    movementId: randomUUID(),
  });

  it('settles once: the second sequential call is not claimed and the row is unchanged (AC-09)', async () => {
    const { card, key, scope } = await setup();
    const settlement = recorded();
    let runs = 0;

    const first = await log.withClaim(scope, key, () => {
      runs += 1;
      return Promise.resolve(settlement);
    });
    const before = await rowsOf(card.id);
    const second = await log.withClaim(scope, key, () => {
      runs += 1;
      return Promise.resolve<AutomaticDebitSettlement>({ status: 'skipped', reason: 'refused' });
    });

    expect(first).toEqual({ claimed: true, settlement });
    expect(second).toEqual({ claimed: false });
    expect(runs).toBe(1);
    expect(await rowsOf(card.id)).toEqual(before);
    expect(before).toEqual([
      {
        period: '2026-10',
        currency: 'ARS',
        status: 'recorded',
        reason: null,
        movement_id: settlement.status === 'recorded' ? settlement.movementId : null,
      },
    ]);
  });

  it('stores a skipped settlement with its reason', async () => {
    const { card, key, scope } = await setup();

    await log.withClaim(scope, key, () =>
      Promise.resolve<AutomaticDebitSettlement>({
        status: 'skipped',
        reason: 'account_unavailable',
      }),
    );

    expect(await rowsOf(card.id)).toEqual([
      {
        period: '2026-10',
        currency: 'ARS',
        status: 'skipped',
        reason: 'account_unavailable',
        movement_id: null,
      },
    ]);
  });

  it('runs settle once when two claims start together (AC-09)', async () => {
    const { card, key, scope } = await setup();
    let runs = 0;
    const slow = async (): Promise<AutomaticDebitSettlement> => {
      runs += 1;
      await wait(300);
      return recorded();
    };

    const results = await Promise.all([
      log.withClaim(scope, key, slow),
      log.withClaim(scope, key, slow),
    ]);

    expect(runs).toBe(1);
    expect(results.filter((result) => result.claimed)).toHaveLength(1);
    expect(results.filter((result) => !result.claimed)).toHaveLength(1);
    expect(await rowsOf(card.id)).toHaveLength(1);
  });

  it('rolls the claim back when settle throws, and the next call settles (sad path)', async () => {
    const { card, key, scope } = await setup();

    await expect(
      log.withClaim(scope, key, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(await rowsOf(card.id)).toEqual([]);

    const next = await log.withClaim(scope, key, () => Promise.resolve(recorded()));
    expect(next.claimed).toBe(true);
    expect(await rowsOf(card.id)).toHaveLength(1);
  });

  it('leaves no row when settle answers null (deferred)', async () => {
    const { card, key, scope } = await setup();

    const result = await log.withClaim(scope, key, () => Promise.resolve(null));

    expect(result).toEqual({ claimed: true, settlement: null });
    expect(await rowsOf(card.id)).toEqual([]);
  });

  it('settledKeys omits pending rows and another owner (sad path, cross-user)', async () => {
    const { card, key, scope } = await setup();
    const other = await setup();
    await log.withClaim(scope, key, () => Promise.resolve(recorded()));
    await log.withClaim(scope, { ...key, period: '2026-09', currency: 'USD' }, () =>
      Promise.resolve<AutomaticDebitSettlement>({ status: 'skipped', reason: 'covered' }),
    );
    await connection.pool.query(
      "insert into card_automatic_debits (card_id, owner_id, period, currency, status) values ($1, $2, '2026-08', 'ARS', 'pending')",
      [card.id, scope.userId],
    );

    const own = await log.settledKeys(scope, card.id);
    const foreign = await log.settledKeys(other.scope, card.id);

    expect([...own].sort()).toEqual(
      [settledKey('2026-10', 'ARS'), settledKey('2026-09', 'USD')].sort(),
    );
    expect(foreign.size).toBe(0);
  });
});

describe('createAutomaticDebitRecorder', () => {
  async function setup() {
    const ownerId = await newUserId(connection.db);
    const from = await newAccount(connection.pool, ownerId);
    const to = await newAccount(connection.pool, ownerId);
    return { ownerId, from, to };
  }
  const occurredAt = new Date('2026-10-05T15:00:00Z');

  async function net(accountId: string): Promise<bigint> {
    const result = await connection.pool.query<{ net: string }>(
      `select coalesce(sum(case when destination_account_id = $1 then destination_amount else 0 end), 0)
            - coalesce(sum(case when account_id = $1 then amount else 0 end), 0) as net
       from movements where account_id = $1 or destination_account_id = $1`,
      [accountId],
    );
    return BigInt(result.rows[0]?.net ?? '0');
  }

  it('records a transfer of the largest allowed amount under the given id and moves both balances (NFR-01)', async () => {
    const { ownerId, from, to } = await setup();
    const recorder = createAutomaticDebitRecorder(connection.db, silent);
    const amount = 999_999_999_999_999n;
    const id = randomUUID();

    const recorded = await recorder.recordOnce(await writeScope(ownerId), id, {
      sourceAccountId: from,
      destinationAccountId: to,
      amount,
      occurredAt,
    });

    expect(recorded.id).toBe(id);
    const rows = await connection.pool.query<{ type: string; amount: string; note: string | null }>(
      'select type, amount, note from movements where id = $1 and owner_id = $2',
      [id, ownerId],
    );
    expect(rows.rows).toEqual([{ type: 'transfer', amount: amount.toString(), note: null }]);
    expect(await net(from)).toBe(-amount);
    expect(await net(to)).toBe(amount);
  });

  it('returns the stored movement on a repeat and writes nothing more', async () => {
    const { ownerId, from, to } = await setup();
    const recorder = createAutomaticDebitRecorder(connection.db, silent);
    const scope = await writeScope(ownerId);
    const id = randomUUID();
    const transfer = { sourceAccountId: from, destinationAccountId: to, amount: 500n, occurredAt };

    await recorder.recordOnce(scope, id, transfer);
    const again = await recorder.recordOnce(scope, id, { ...transfer, amount: 999n });

    expect(again).toEqual({ id });
    expect(await net(to)).toBe(500n);
  });

  it('does not spend the manual write budget', async () => {
    const { ownerId, from, to } = await setup();
    const recorder = createAutomaticDebitRecorder(connection.db, silent, { writeLimit: 1 });
    const scope = await writeScope(ownerId);
    const transfer = { sourceAccountId: from, destinationAccountId: to, amount: 10n, occurredAt };

    await recorder.recordOnce(scope, randomUUID(), transfer);
    await recorder.recordOnce(scope, randomUUID(), transfer);

    expect(await net(to)).toBe(20n);
  });

  it('raises ResourceNotFound when the id belongs to another user (sad path)', async () => {
    const owner = await setup();
    const other = await setup();
    const recorder = createAutomaticDebitRecorder(connection.db, silent);
    const id = randomUUID();
    await recorder.recordOnce(await writeScope(owner.ownerId), id, {
      sourceAccountId: owner.from,
      destinationAccountId: owner.to,
      amount: 1n,
      occurredAt,
    });

    await expect(
      recorder.recordOnce(await writeScope(other.ownerId), id, {
        sourceAccountId: other.from,
        destinationAccountId: other.to,
        amount: 1n,
        occurredAt,
      }),
    ).rejects.toMatchObject({ name: 'ResourceNotFound' });
  });

  it('raises the movement error for an archived source account (sad path)', async () => {
    const ownerId = await newUserId(connection.db);
    const from = await newAccount(connection.pool, ownerId, true);
    const to = await newAccount(connection.pool, ownerId);
    const recorder = createAutomaticDebitRecorder(connection.db, silent);

    await expect(
      recorder.recordOnce(await writeScope(ownerId), randomUUID(), {
        sourceAccountId: from,
        destinationAccountId: to,
        amount: 1n,
        occurredAt,
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_ARCHIVED' });
    expect(await net(to)).toBe(0n);
  });
});
