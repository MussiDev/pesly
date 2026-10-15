interface Closing {
  closingDate: string;
}

/**
 * The statement a calendar day belongs to: the first one, ordered by closing date, that closes on
 * or after the day (FR-02). A day earlier than every cycle goes to the first statement; a day after
 * the last closing date belongs to none yet.
 */
export function assignStatement<T extends Closing>(
  day: string,
  statements: readonly T[],
): T | undefined {
  return statements.find((statement) => statement.closingDate >= day);
}
