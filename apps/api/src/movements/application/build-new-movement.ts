import {
  AppError,
  dateInTimeZone,
  impliedRate,
  todayInTimeZone,
  type CategorizedMovementType,
  type RateType,
} from '@pesly/shared';
import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import {
  CategoryArchived,
  ExchangeSameCurrency,
  ImpliedRateOutOfRange,
  MovementAccountArchived,
  MovementCategoryKindMismatch,
  MovementCurrencyMismatch,
  MovementDateInFuture,
  MovementSameAccount,
  RateRequired,
} from '../domain/errors';
import type { Movement, NewMovement } from '../domain/movement';
import type { AccountLookup } from './ports/account-lookup';
import type { CategoryLookup } from './ports/category-lookup';
import type { Clock } from './ports/clock';
import type { RateLookup } from './ports/rate-lookup';
import type { UserPreferences } from './ports/user-preferences';

export interface BuildMovementDependencies {
  accounts: AccountLookup;
  categories: CategoryLookup;
  rates: RateLookup;
  preferences: UserPreferences;
  clock: Clock;
}

interface MovementInputBase {
  accountId: string;
  amount: bigint;
  occurredAt: Date;
  note?: string;
}

/** Already parsed by the shared contract: bigint amounts, a `Date` instant, no empty note. */
export interface CategorizedMovementInput extends MovementInputBase {
  type: CategorizedMovementType;
  categoryId: string;
  tags?: string[];
  rate: { source: 'automatic' } | { source: 'manual'; value: bigint };
}

/** `accountId` is the source; the destination receives the same `amount`. */
export interface TransferInput extends MovementInputBase {
  type: 'transfer';
  destinationAccountId: string;
}

/** `amount` leaves the source, `destinationAmount` enters the destination. */
export interface ExchangeInput extends MovementInputBase {
  type: 'exchange';
  destinationAccountId: string;
  destinationAmount: bigint;
}

export type CreateMovementInput = CategorizedMovementInput | TransferInput | ExchangeInput;

/** An edit may also keep the rate the movement already has. */
export interface EditCategorizedMovementInput extends Omit<CategorizedMovementInput, 'rate'> {
  rate: CategorizedMovementInput['rate'] | { source: 'keep' };
}

export type EditMovementInput = EditCategorizedMovementInput | TransferInput | ExchangeInput;

function normalizedNote(note: string | undefined): string | null {
  return note === undefined || note.trim() === '' ? null : note;
}

/**
 * Whether a reference is new for this movement. An edit may keep an archived account or category the
 * movement already points at; only a reference that changes has to be open.
 */
function changed<T>(existing: Movement | undefined, current: T | undefined, next: T): boolean {
  return existing === undefined || current !== next;
}

/**
 * The rules every saved movement obeys, for a creation and for an edit alike: a date not after
 * today in the user's time zone, accounts and category of the caller that are open, the category
 * kind, the rate (stored once, then frozen), and the implied rate of an exchange. Returns what the
 * repository stores; with `existing` it applies the edit rules (`keep`, unchanged archived
 * references). Never writes anything.
 */
export async function buildNewMovement(
  deps: BuildMovementDependencies,
  scope: AccessScope<'write'>,
  input: CreateMovementInput | EditMovementInput,
  existing?: Movement,
): Promise<NewMovement> {
  const { timeZone, defaultRateType } = await deps.preferences.find(scope.userId);

  if (dateInTimeZone(input.occurredAt, timeZone) > todayInTimeZone(deps.clock.now(), timeZone)) {
    throw new MovementDateInFuture();
  }

  if (input.type === 'transfer' || input.type === 'exchange') {
    return betweenAccounts(deps, scope, input, existing);
  }

  const account = notFoundUnlessAllowed(await deps.accounts.find(scope, input.accountId));
  if (account.archived && changed(existing, existing?.accountId, input.accountId)) {
    throw new MovementAccountArchived();
  }

  const category = notFoundUnlessAllowed(await deps.categories.find(scope, input.categoryId));
  if (category.kind !== input.type) throw new MovementCategoryKindMismatch();
  const storedCategoryId =
    existing !== undefined && 'categoryId' in existing ? existing.categoryId : undefined;
  if (category.archived && changed(existing, storedCategoryId, input.categoryId)) {
    throw new CategoryArchived();
  }

  let rate: bigint;
  let rateSource: 'automatic' | 'manual';
  let rateType: RateType | null;
  if (input.rate.source === 'keep') {
    if (existing === undefined || !('categoryId' in existing)) {
      throw new AppError('VALIDATION_FAILED', 'keep needs the rate of the movement being edited');
    }
    ({ rate, rateSource, rateType } = existing);
  } else if (input.rate.source === 'manual') {
    rate = input.rate.value;
    rateSource = 'manual';
    rateType = null;
  } else {
    const stored = await deps.rates.latestSell(defaultRateType);
    if (!stored) throw new RateRequired();
    rate = stored.sell;
    rateSource = 'automatic';
    rateType = defaultRateType;
  }

  return {
    type: input.type,
    accountId: input.accountId,
    categoryId: input.categoryId,
    amount: input.amount,
    occurredAt: input.occurredAt,
    note: normalizedNote(input.note),
    rate,
    rateSource,
    rateType,
    tags: input.tags ?? [],
  };
}

/** Transfer and exchange rules, in order; reads no stored rate (the rate comes from the amounts). */
async function betweenAccounts(
  deps: BuildMovementDependencies,
  scope: AccessScope<'write'>,
  input: TransferInput | ExchangeInput,
  existing: Movement | undefined,
): Promise<NewMovement> {
  if (input.accountId === input.destinationAccountId) throw new MovementSameAccount();

  const source = notFoundUnlessAllowed(await deps.accounts.find(scope, input.accountId));
  const destination = notFoundUnlessAllowed(
    await deps.accounts.find(scope, input.destinationAccountId),
  );
  const storedDestinationId =
    existing !== undefined && 'destinationAccountId' in existing
      ? existing.destinationAccountId
      : undefined;
  if (
    (source.archived && changed(existing, existing?.accountId, input.accountId)) ||
    (destination.archived && changed(existing, storedDestinationId, input.destinationAccountId))
  ) {
    throw new MovementAccountArchived();
  }

  const common = {
    accountId: input.accountId,
    destinationAccountId: input.destinationAccountId,
    amount: input.amount,
    occurredAt: input.occurredAt,
    note: normalizedNote(input.note),
  };

  if (input.type === 'transfer') {
    if (source.currency !== destination.currency) throw new MovementCurrencyMismatch();
    return { ...common, type: 'transfer', destinationAmount: input.amount };
  }

  if (source.currency === destination.currency) throw new ExchangeSameCurrency();
  const [ars, usd] =
    source.currency === 'ARS'
      ? [input.amount, input.destinationAmount]
      : [input.destinationAmount, input.amount];
  const rate = impliedRate(ars, usd);
  if (rate === null) throw new ImpliedRateOutOfRange();
  return {
    ...common,
    type: 'exchange',
    destinationAmount: input.destinationAmount,
    rate,
    rateSource: 'implied',
    rateType: null,
  };
}
