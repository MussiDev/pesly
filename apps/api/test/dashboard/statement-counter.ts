import pg from 'pg';
import { vi, type MockInstance } from 'vitest';

type QueryFunction = (this: pg.Client, ...args: unknown[]) => unknown;

export interface StatementCounter {
  /** The text of every statement the database received since the counter started. */
  readonly statements: string[];
  readonly count: number;
  stop(): void;
}

/**
 * Counts every statement sent through `pg.Client.prototype.query`, which is where the pool, the
 * Drizzle driver and the session lookup all end up (spec D13, AC-54).
 */
export function startStatementCounter(): StatementCounter {
  const statements: string[] = [];
  const target = pg.Client.prototype as unknown as { query: QueryFunction };
  const original = target.query;
  const spy: MockInstance<QueryFunction> = vi.spyOn(target, 'query').mockImplementation(function (
    this: pg.Client,
    ...args: unknown[]
  ) {
    const [first] = args;
    if (typeof first === 'string') statements.push(first);
    else if (typeof first === 'object' && first !== null && 'text' in first) {
      statements.push(String(first.text));
    } else statements.push('<unknown>');
    return original.apply(this, args);
  });
  return {
    statements,
    get count() {
      return statements.length;
    },
    stop() {
      spy.mockRestore();
    },
  };
}
