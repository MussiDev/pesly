import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StatementReminderEntry } from '../../src/credit-cards/application/ports/statement-reminder-source';
import { DrizzleCreditCardRepository } from '../../src/credit-cards/infrastructure/db/drizzle-credit-card-repository';
import { DrizzleStatementReminderSource } from '../../src/credit-cards/infrastructure/db/drizzle-statement-reminder-source';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newUserId, writeScope } from '../movements/db-fixtures';

let connection: DatabaseConnection;
let cards: DrizzleCreditCardRepository;
let source: DrizzleStatementReminderSource;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  cards = new DrizzleCreditCardRepository(connection.db);
  source = new DrizzleStatementReminderSource(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

async function newCard(ownerId: string, reminderDays = 3) {
  const scope = await writeScope(ownerId);
  const { card } = await cards.create(scope, {
    name: `Visa ${randomUUID().slice(0, 8)}`,
    closingDay: 24,
    dueDay: 5,
    reminderDays,
    firstStatement: { period: '2026-10', closingDate: '2026-10-24', dueDate: '2026-11-05' },
  });
  return card;
}

async function readAll(limit: number): Promise<StatementReminderEntry[]> {
  const all: StatementReminderEntry[] = [];
  let afterId: string | null = null;
  for (;;) {
    const page: StatementReminderEntry[] = await source.page(afterId, limit);
    expect(page.length).toBeLessThanOrEqual(limit);
    all.push(...page);
    const last = page[page.length - 1];
    if (page.length < limit || !last) return all;
    afterId = last.card.id;
  }
}

const setLanguage = (ownerId: string, language: 'es' | 'en') =>
  connection.pool.query('update users set language = $2 where id = $1', [ownerId, language]);

describe('DrizzleStatementReminderSource', () => {
  it('returns every card with the owner, zone and language of its user, paged without gaps (FR-01)', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db, { timeZone: 'Asia/Tokyo' });
    await setLanguage(bea, 'en');
    const anaCards = [await newCard(ana), await newCard(ana, 0)];
    const beaCard = await newCard(bea, 7);
    const mine = new Set([...anaCards.map((card) => card.id), beaCard.id]);

    const all = (await readAll(2)).filter((entry) => mine.has(entry.card.id));

    expect(all).toHaveLength(3);
    expect(new Set(all.map((entry) => entry.card.id)).size).toBe(3);
    const ids = (await readAll(2)).map((entry) => entry.card.id);
    expect([...ids].sort()).toEqual(ids);
    const byId = new Map(all.map((entry) => [entry.card.id, entry]));
    expect(byId.get(anaCards[0]?.id ?? '')).toMatchObject({
      ownerId: ana,
      timeZone: 'America/Cordoba',
      language: 'es',
      card: { reminderDays: 3, closingDay: 24, dueDay: 5 },
    });
    expect(byId.get(anaCards[1]?.id ?? '')?.card.reminderDays).toBe(0);
    expect(byId.get(beaCard.id)).toMatchObject({
      ownerId: bea,
      timeZone: 'Asia/Tokyo',
      language: 'en',
      card: { reminderDays: 7 },
    });
    expect(byId.get(beaCard.id)?.card.debitAccounts).toEqual({ ARS: null, USD: null });
  });

  it('returns no entry for a deleted card and none for an erased user (AC-09, sad path)', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const deleted = await newCard(ana);
    const orphaned = await newCard(bea);

    expect(await cards.delete(await writeScope(ana), deleted)).toBe(true);
    await connection.pool.query('delete from users where id = $1', [bea]);

    const ids = (await readAll(500)).map((entry) => entry.card.id);
    expect(ids).not.toContain(deleted.id);
    expect(ids).not.toContain(orphaned.id);
  });

  it('returns nothing after the last card id', async () => {
    expect(await source.page('ffffffff-ffff-4fff-8fff-ffffffffffff', 10)).toEqual([]);
  });
});
