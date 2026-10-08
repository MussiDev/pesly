import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExpenseCategoryGuard, createInstallmentWriteLimit } from '../../src/movements';
import { MovementWriteRateLimited } from '../../src/movements/domain/errors';
import { ResourceNotFound } from '../../src/shared/access';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { MutableClock } from '../fakes/mutable-clock';
import { testDatabaseUrl } from '../helpers/test-database';
import { newCategory, newUserId, writeScope } from '../movements/db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const logger = createLogger({ level: 'silent', destination: { write: () => undefined } });

describe('createExpenseCategoryGuard', () => {
  it('accepts an open expense category of the caller', async () => {
    const owner = await newUserId(connection.db);
    const guard = createExpenseCategoryGuard(connection.db);

    await expect(
      guard.assertOpenExpenseCategory(
        await writeScope(owner),
        await newCategory(connection.pool, owner, 'expense'),
      ),
    ).resolves.toBeUndefined();
  });

  it('refuses an income, an archived and a foreign category (sad path)', async () => {
    const owner = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    const guard = createExpenseCategoryGuard(connection.db);
    const scope = await writeScope(owner);

    await expect(
      guard.assertOpenExpenseCategory(scope, await newCategory(connection.pool, owner, 'income')),
    ).rejects.toMatchObject({ code: 'MOVEMENT_CATEGORY_KIND_MISMATCH' });
    await expect(
      guard.assertOpenExpenseCategory(
        scope,
        await newCategory(connection.pool, owner, 'expense', true),
      ),
    ).rejects.toMatchObject({ code: 'CATEGORY_ARCHIVED' });
    await expect(
      guard.assertOpenExpenseCategory(scope, await newCategory(connection.pool, other, 'expense')),
    ).rejects.toBeInstanceOf(ResourceNotFound);
  });
});

describe('createInstallmentWriteLimit', () => {
  it('refuses the unit after the limit, and a refund gives it back (sad path)', async () => {
    const owner = await newUserId(connection.db);
    const clock = new MutableClock(new Date('2026-10-06T15:00:00.000Z'));
    const limit = createInstallmentWriteLimit(connection.db, logger, { writeLimit: 2, clock });
    const scope = await writeScope(owner);

    const first = await limit.take(scope);
    await limit.take(scope);
    await expect(limit.take(scope)).rejects.toBeInstanceOf(MovementWriteRateLimited);

    await first.release();
    await expect(limit.take(scope)).resolves.toBeDefined();
  });

  it('shares the manual bucket per owner and starts again in the next window', async () => {
    const ana = await newUserId(connection.db);
    const bob = await newUserId(connection.db);
    const clock = new MutableClock(new Date('2026-10-06T15:00:00.000Z'));
    const limit = createInstallmentWriteLimit(connection.db, logger, { writeLimit: 1, clock });

    await limit.take(await writeScope(ana));
    await expect(limit.take(await writeScope(ana))).rejects.toBeInstanceOf(
      MovementWriteRateLimited,
    );
    await expect(limit.take(await writeScope(bob))).resolves.toBeDefined();
    clock.advance(61_000);
    await expect(limit.take(await writeScope(ana))).resolves.toBeDefined();
  });

  it('rejects a limit below 1 (invalid input)', () => {
    expect(() => createInstallmentWriteLimit(connection.db, logger, { writeLimit: 0 })).toThrow(
      RangeError,
    );
  });
});
