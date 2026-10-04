import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccountMovements } from '../../src/movements';
import type { Movement } from '../../src/movements/domain/movement';
import type { NewMovement } from '../../src/movements/application/ports/movement-repository';
import { DrizzleMovementRepository } from '../../src/movements/infrastructure/db/drizzle-movement-repository';
import { ResourceNotFound } from '../../src/shared/access/not-found-unless-allowed';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory, newUserId, readScope, writeScope } from './db-fixtures';

let connection: DatabaseConnection;
let repository: DrizzleMovementRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleMovementRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

interface Fixture {
  ownerId: string;
  arsId: string;
  ars2Id: string;
  usdId: string;
  expenseCategoryId: string;
  otherExpenseCategoryId: string;
}

async function fixture(): Promise<Fixture> {
  const ownerId = await newUserId(connection.db);
  return {
    ownerId,
    arsId: await newAccount(connection.pool, ownerId),
    ars2Id: await newAccount(connection.pool, ownerId),
    usdId: await newAccount(connection.pool, ownerId, false, 'USD'),
    expenseCategoryId: await newCategory(connection.pool, ownerId, 'expense'),
    otherExpenseCategoryId: await newCategory(connection.pool, ownerId, 'expense'),
  };
}

const WHEN = new Date('2026-10-02T15:30:00.000Z');

function expense(f: Fixture, overrides: Record<string, unknown> = {}): NewMovement {
  return {
    type: 'expense',
    accountId: f.arsId,
    categoryId: f.expenseCategoryId,
    amount: 1_000n,
    occurredAt: WHEN,
    note: null,
    rate: 14_000_000n,
    rateSource: 'manual',
    rateType: null,
    tags: [],
    ...overrides,
  };
}

function transfer(f: Fixture, overrides: Record<string, unknown> = {}): NewMovement {
  return {
    type: 'transfer',
    accountId: f.arsId,
    destinationAccountId: f.ars2Id,
    amount: 500n,
    destinationAmount: 500n,
    occurredAt: WHEN,
    note: null,
    ...overrides,
  };
}

function exchange(f: Fixture, overrides: Record<string, unknown> = {}): NewMovement {
  return {
    type: 'exchange',
    accountId: f.arsId,
    destinationAccountId: f.usdId,
    amount: 150_000n,
    destinationAmount: 100n,
    occurredAt: WHEN,
    note: null,
    rate: 15_000_000n,
    rateSource: 'implied',
    rateType: null,
    ...overrides,
  };
}

async function insert(f: Fixture, data: NewMovement): Promise<Movement> {
  return repository.insert(await writeScope(f.ownerId), data);
}

/** The balance contribution of every movement, as the accounts module sums it on read. */
async function sums(...accountIds: string[]): Promise<bigint[]> {
  const map = await createAccountMovements(connection.db).sumsByAccount(accountIds);
  return accountIds.map((id) => map.get(id) ?? 0n);
}

async function linkCount(movementId: string): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    'select count(*) as n from movement_tags where movement_id = $1',
    [movementId],
  );
  return Number(result.rows[0]?.n);
}

describe('DrizzleMovementRepository.update', () => {
  it('changes the summed balance of the account by the difference when the amount changes (AC-01)', async () => {
    const f = await fixture();
    const created = await insert(f, expense(f));
    expect(await sums(f.arsId)).toEqual([-1_000n]);

    const updated = await repository.update(
      await writeScope(f.ownerId),
      created.id,
      expense(f, { amount: 1_500n }),
    );

    expect(updated?.amount).toBe(1_500n);
    expect(await sums(f.arsId)).toEqual([-1_500n]);
  });

  it('recomputes both accounts when an expense moves: the old gets the amount back, the new loses it (AC-01)', async () => {
    const f = await fixture();
    const created = await insert(f, expense(f));

    await repository.update(
      await writeScope(f.ownerId),
      created.id,
      expense(f, { accountId: f.ars2Id }),
    );

    expect(await sums(f.arsId, f.ars2Id)).toEqual([0n, -1_000n]);
  });

  it('persists note, tags, category, rate and date, sets updated_at and keeps createdAt (AC-01)', async () => {
    const f = await fixture();
    const created = await insert(f, expense(f, { tags: ['Viaje', 'comida'] }));
    expect(await linkCount(created.id)).toBe(2);

    const updated = await repository.update(
      await writeScope(f.ownerId),
      created.id,
      expense(f, {
        categoryId: f.otherExpenseCategoryId,
        note: 'corrected',
        tags: ['super'],
        rate: 15_500_000n,
        rateSource: 'automatic',
        rateType: 'blue',
        occurredAt: new Date('2026-09-30T10:00:00.000Z'),
      }),
    );

    expect(updated).toMatchObject({
      id: created.id,
      ownerId: f.ownerId,
      categoryId: f.otherExpenseCategoryId,
      note: 'corrected',
      tags: ['super'],
      rate: 15_500_000n,
      rateSource: 'automatic',
      rateType: 'blue',
      occurredAt: new Date('2026-09-30T10:00:00.000Z'),
    });
    expect(updated?.createdAt).toEqual(created.createdAt);
    expect(await linkCount(created.id)).toBe(1);
    const found = await repository.findById(await readScope(f.ownerId), created.id);
    expect(found?.tags).toEqual(['super']);
    const stamps = await connection.pool.query<{ later: boolean }>(
      'select updated_at > created_at as later from movements where id = $1',
      [created.id],
    );
    expect(stamps.rows[0]?.later).toBe(true);
  });

  it('removes every tag when the edit carries none (AC-01)', async () => {
    const f = await fixture();
    const created = await insert(f, expense(f, { tags: ['a', 'b', 'c'] }));

    const updated = await repository.update(
      await writeScope(f.ownerId),
      created.id,
      expense(f, { tags: [] }),
    );

    expect(updated?.tags).toEqual([]);
    expect(await linkCount(created.id)).toBe(0);
  });

  it('recomputes the source and the destination of a transfer and of an exchange (AC-01)', async () => {
    const f = await fixture();
    const sent = await insert(f, transfer(f));
    expect(await sums(f.arsId, f.ars2Id)).toEqual([-500n, 500n]);
    await repository.update(
      await writeScope(f.ownerId),
      sent.id,
      transfer(f, { amount: 800n, destinationAmount: 800n }),
    );
    expect(await sums(f.arsId, f.ars2Id)).toEqual([-800n, 800n]);

    const g = await fixture();
    const changed = await insert(g, exchange(g));
    expect(await sums(g.arsId, g.usdId)).toEqual([-150_000n, 100n]);
    await repository.update(
      await writeScope(g.ownerId),
      changed.id,
      exchange(g, { amount: 300_000n, destinationAmount: 200n }),
    );
    expect(await sums(g.arsId, g.usdId)).toEqual([-300_000n, 200n]);
  });

  it('does not update the movement of another owner: null (404) and the row is unchanged (AC-03)', async () => {
    const f = await fixture();
    const created = await insert(f, expense(f));
    const bob = await newUserId(connection.db);

    const result = await repository.update(
      await writeScope(bob),
      created.id,
      expense(f, { amount: 9_999n }),
    );

    expect(result).toBeNull();
    const found = await repository.findById(await readScope(f.ownerId), created.id);
    expect(found?.amount).toBe(1_000n);
  });

  it('answers null for a missing id and for a different type than the stored one (AC-03)', async () => {
    const f = await fixture();
    const created = await insert(f, expense(f));
    const scope = await writeScope(f.ownerId);

    expect(await repository.update(scope, randomUUID(), expense(f))).toBeNull();
    expect(await repository.update(scope, created.id, transfer(f))).toBeNull();
    const found = await repository.findById(await readScope(f.ownerId), created.id);
    expect(found?.type).toBe('expense');
  });

  it('maps an account that vanished to not found, never an error 500 (AC-01)', async () => {
    const f = await fixture();
    const created = await insert(f, expense(f));

    await expect(
      repository.update(
        await writeScope(f.ownerId),
        created.id,
        expense(f, { accountId: randomUUID() }),
      ),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(
      repository.update(
        await writeScope(f.ownerId),
        created.id,
        expense(f, { categoryId: randomUUID() }),
      ),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    const found = await repository.findById(await readScope(f.ownerId), created.id);
    expect(found?.accountId).toBe(f.arsId);
  });

  it('rolls the whole edit back when the tag write fails (AC-01)', async () => {
    const f = await fixture();
    const created = await insert(f, expense(f, { tags: ['keep'] }));
    const eleven = Array.from({ length: 11 }, (_, index) => `tag${index}`);

    await expect(
      repository.update(
        await writeScope(f.ownerId),
        created.id,
        expense(f, { amount: 7_777n, tags: eleven }),
      ),
    ).rejects.toThrow();

    const found = await repository.findById(await readScope(f.ownerId), created.id);
    expect(found).toMatchObject({ amount: 1_000n, tags: ['keep'] });
  });
});

describe('DrizzleMovementRepository.delete', () => {
  it('removes an expense, an income, a transfer and an exchange with their tag links and reverses every balance (AC-02)', async () => {
    const f = await fixture();
    const incomeCategory = await newCategory(connection.pool, f.ownerId, 'income');
    const scope = await writeScope(f.ownerId);
    const created = [
      await insert(f, expense(f, { tags: ['a', 'b'] })),
      await insert(f, expense(f, { type: 'income', categoryId: incomeCategory, tags: ['salary'] })),
      await insert(f, transfer(f)),
      await insert(f, exchange(f)),
    ];
    expect(await sums(f.arsId, f.ars2Id, f.usdId)).not.toEqual([0n, 0n, 0n]);

    for (const movement of created) {
      expect(await repository.delete(scope, movement.id)).toBe(true);
      expect(await repository.findById(await readScope(f.ownerId), movement.id)).toBeNull();
      expect(await linkCount(movement.id)).toBe(0);
    }
    expect(await sums(f.arsId, f.ars2Id, f.usdId)).toEqual([0n, 0n, 0n]);
  });

  it('keeps the tags of the user after a delete, as suggestions (AC-02)', async () => {
    const f = await fixture();
    const created = await insert(f, expense(f, { tags: ['Viaje'] }));

    await repository.delete(await writeScope(f.ownerId), created.id);

    const tagRows = await connection.pool.query('select 1 from tags where owner_id = $1', [
      f.ownerId,
    ]);
    expect(tagRows.rowCount).toBe(1);
  });

  it('does not delete the movement of another owner: false (404) and the row is unchanged (AC-03)', async () => {
    const f = await fixture();
    const created = await insert(f, expense(f));
    const bob = await newUserId(connection.db);

    expect(await repository.delete(await writeScope(bob), created.id)).toBe(false);
    expect(await repository.findById(await readScope(f.ownerId), created.id)).not.toBeNull();
  });

  it('answers false for a missing id and a second delete of the same movement (AC-03)', async () => {
    const f = await fixture();
    const created = await insert(f, expense(f));
    const scope = await writeScope(f.ownerId);

    expect(await repository.delete(scope, randomUUID())).toBe(false);
    expect(await repository.delete(scope, created.id)).toBe(true);
    expect(await repository.delete(scope, created.id)).toBe(false);
  });
});
