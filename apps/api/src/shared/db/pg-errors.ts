const MAX_CAUSE_DEPTH = 5;

/**
 * The name of the constraint `error` violated when it is a PostgreSQL error with `code` (23505
 * unique violation, 23503 foreign-key violation, 23514 check violation), or undefined for any other error. Drizzle wraps
 * driver errors (DrizzleQueryError), so the pg error may sit in the cause chain.
 */
export function violatedConstraint(
  error: unknown,
  code: '23505' | '23503' | '23514',
): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if (Reflect.get(current, 'code') === code) {
      const constraint: unknown = Reflect.get(current, 'constraint');
      return typeof constraint === 'string' ? constraint : undefined;
    }
    current = current.cause;
  }
  return undefined;
}
