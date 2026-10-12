import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExpenseSavedHook } from '../../src/movements/application/ports/expense-saved-listener';
import {
  createExpenseRecorder,
  createMovementsExpenseRecorder,
} from '../../src/movements/infrastructure/accounts/drizzle-expense-recorder';
import { createRecurringExpenseRecorder } from '../../src/movements/infrastructure/recurring/drizzle-recurring-expense-recorder';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory, newUserId, writeScope } from './db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const logger = createLogger({ level: 'silent', destination: { write: () => undefined } });
const occurredAt = new Date('2026-10-01T15:00:00Z');
const srcRoot = join(__dirname, '../../src');

function recordingHook() {
  const calls: { userId: string; categoryId: string; occurredAt: Date }[] = [];
  const hook: ExpenseSavedHook = {
    run: (scope, event) => {
      calls.push({ userId: scope.userId, ...event });
      return Promise.resolve();
    },
  };
  return { hook, calls };
}

async function setup() {
  const ownerId = await newUserId(connection.db);
  const accountId = await newAccount(connection.pool, ownerId);
  const categoryId = await newCategory(connection.pool, ownerId, 'expense');
  const expense = {
    accountId,
    categoryId,
    amount: 5_000n,
    occurredAt,
    rate: { source: 'manual' as const, value: 14_000_000n },
  };
  return { ownerId, categoryId, expense };
}

describe('expense recorders and the expense saved hook', () => {
  it('the installments recorder calls the hook like a manual expense (AC-07)', async () => {
    const { ownerId, categoryId, expense } = await setup();
    const { hook, calls } = recordingHook();
    const recorder = createExpenseRecorder(connection.db, logger, { expenseSaved: hook });

    await recorder.record(await writeScope(ownerId), expense);

    expect(calls).toEqual([{ userId: ownerId, categoryId, occurredAt }]);
  });

  it('the recurring recorder calls the hook on record and recordOnce, and a replay does not (AC-07)', async () => {
    const { ownerId, categoryId, expense } = await setup();
    const { hook, calls } = recordingHook();
    const recorder = createRecurringExpenseRecorder(connection.db, logger, {
      expenseSaved: hook,
    });
    const scope = await writeScope(ownerId);
    const id = randomUUID();

    await recorder.record(scope, expense);
    await recorder.recordOnce(scope, id, expense);
    await recorder.recordOnce(scope, id, expense);

    expect(calls).toEqual([
      { userId: ownerId, categoryId, occurredAt },
      { userId: ownerId, categoryId, occurredAt },
    ]);
  });

  it('recordUnmetered skips the hook while record and recordUnmeteredWithId run it (statement import)', async () => {
    const { ownerId, categoryId, expense } = await setup();
    const { hook, calls } = recordingHook();
    const recorder = createMovementsExpenseRecorder(connection.db, logger, { expenseSaved: hook });
    const scope = await writeScope(ownerId);

    await recorder.recordUnmetered(scope, expense);
    expect(calls).toEqual([]);

    await recorder.record(scope, expense);
    await recorder.recordUnmeteredWithId(scope, randomUUID(), expense);
    expect(calls).toEqual([
      { userId: ownerId, categoryId, occurredAt },
      { userId: ownerId, categoryId, occurredAt },
    ]);
  });

  it('recorders built with no hook behave as before (AC-06)', async () => {
    const { ownerId, expense } = await setup();
    const recorder = createExpenseRecorder(connection.db, logger);

    await expect(recorder.record(await writeScope(ownerId), expense)).resolves.toMatchObject({
      occurredAt,
    });
  });
});

describe('writers that must not evaluate (AC-20)', () => {
  const files = [
    'movements/infrastructure/credit-cards/drizzle-automatic-debit-recorder.ts',
    'movements/infrastructure/credit-cards/drizzle-statement-payment-recorder.ts',
    'groups/application/ports/payer-movement-recorder.ts',
    'groups/infrastructure/db/drizzle-group-expense-repository.ts',
  ];

  it.each(files)('%s does not reference the hook', (file) => {
    expect(readFileSync(join(srcRoot, file), 'utf8')).not.toMatch(/expenseSaved|ExpenseSaved/);
  });
});

describe('movements module boundary', () => {
  it('imports nothing from budgets', () => {
    const files = [
      'movements/application/best-effort-expense-saved.ts',
      'movements/application/ports/expense-saved-listener.ts',
      'movements/application/create-movement.ts',
      'movements/application/update-movement.ts',
    ];
    for (const file of files) {
      expect(readFileSync(join(srcRoot, file), 'utf8')).not.toMatch(/from '[./]+\/budgets/);
    }
  });
});
