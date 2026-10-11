import {
  dateInTimeZone,
  zonedLocalToInstant,
  type AccountCurrency,
  type PersonalSharesQuery,
} from '@pesly/shared';

export type SharesFieldName = 'from' | 'to';

export type SharesFieldMessage =
  | 'groups.shares.errors.fromRequired'
  | 'groups.shares.errors.fromInvalid'
  | 'groups.shares.errors.toRequired'
  | 'groups.shares.errors.toInvalid'
  | 'groups.shares.errors.rangeOrder';

export type SharesFieldErrors = Partial<Record<SharesFieldName, SharesFieldMessage>>;

/** Calendar days (`YYYY-MM-DD`) as typed or picked. */
export interface SharesRangeValues {
  from: string;
  to: string;
}

export type SharesRequestResult =
  | { request: Required<Pick<PersonalSharesQuery, 'from' | 'to'>>; fields?: undefined }
  | { request?: undefined; fields: SharesFieldErrors };

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LAST_MS_OF_DAY = 59_999;

function isCalendarDay(text: string): boolean {
  const match = DAY_PATTERN.exec(text);
  if (match === null) return false;
  const [year = 0, month = 0, day = 0] = match.slice(1).map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function check(text: string, name: SharesFieldName): SharesFieldMessage | undefined {
  if (text.trim() === '') return `groups.shares.errors.${name}Required`;
  return isCalendarDay(text.trim()) ? undefined : `groups.shares.errors.${name}Invalid`;
}

/**
 * The query for the range, as UTC instants of the user's local days (first minute of `from` to the
 * last millisecond of `to`), or the catalog path of what is wrong per field.
 */
export function buildSharesRequest(
  values: SharesRangeValues,
  timeZone: string,
): SharesRequestResult {
  const fields: SharesFieldErrors = {};
  const fromError = check(values.from, 'from');
  const toError = check(values.to, 'to');
  if (fromError) fields.from = fromError;
  if (toError) fields.to = toError;
  if (fromError || toError) return { fields };

  const from = values.from.trim();
  const to = values.to.trim();
  if (from > to) return { fields: { to: 'groups.shares.errors.rangeOrder' } };

  const start = zonedLocalToInstant(`${from}T00:00`, timeZone);
  const lastMinute = zonedLocalToInstant(`${to}T23:59`, timeZone);
  if (start === null) return { fields: { from: 'groups.shares.errors.fromInvalid' } };
  if (lastMinute === null) return { fields: { to: 'groups.shares.errors.toInvalid' } };
  return {
    request: {
      from: start.toISOString(),
      to: new Date(lastMinute.getTime() + LAST_MS_OF_DAY).toISOString(),
    },
  };
}

/** The first and last day of the month that `now` falls in, in the user's time zone. */
export function currentMonthRange(now: Date, timeZone: string): SharesRangeValues {
  const today = dateInTimeZone(now, timeZone);
  const year = Number.parseInt(today.slice(0, 4), 10);
  const month = Number.parseInt(today.slice(5, 7), 10);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = today.slice(0, 7);
  return { from: `${prefix}-01`, to: `${prefix}-${String(lastDay).padStart(2, '0')}` };
}

export interface CurrencyTotal {
  currency: AccountCurrency;
  total: bigint;
}

/** Sums the share amounts per currency (first appearance order); currencies are never converted. */
export function sumByCurrency(
  items: readonly { currency: AccountCurrency; shareAmount: string }[],
): CurrencyTotal[] {
  const totals = new Map<AccountCurrency, bigint>();
  for (const item of items) {
    totals.set(item.currency, (totals.get(item.currency) ?? 0n) + BigInt(item.shareAmount));
  }
  return Array.from(totals, ([currency, total]) => ({ currency, total }));
}
