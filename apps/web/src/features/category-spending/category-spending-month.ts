const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(value: string | null): value is string {
  return value !== null && MONTH.test(value);
}

/** The `YYYY-MM` `count` months after (or, negative, before) `month`. */
export function addMonth(month: string, count: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + count;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The first and last day of `month`, `YYYY-MM-DD`. */
export function monthRange(month: string): { from: string; to: string } {
  const days = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(days).padStart(2, '0')}` };
}
