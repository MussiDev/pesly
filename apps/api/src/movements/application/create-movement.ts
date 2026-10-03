import {
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
import type { MovementRepository } from './ports/movement-repository';
import type { RateLookup } from './ports/rate-lookup';
import type { UserPreferences } from './ports/user-preferences';

export interface CreateMovementDependencies {
  movements: MovementRepository;
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

/** Already parsed by the shared schema: bigint amounts, a `Date` instant, no empty note. */
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

function normalizedNote(note: string | undefined): string | null {
  return note === undefined || note.trim() === '' ? null : note;
}

export class CreateMovement {
  constructor(private readonly deps: CreateMovementDependencies) {}

  /** Never touches the write limiter, so a bulk import that calls it is not counted. */
  async execute(scope: AccessScope<'write'>, input: CreateMovementInput): Promise<Movement> {
    const { timeZone, defaultRateType } = await this.deps.preferences.find(scope.userId);

    if (
      dateInTimeZone(input.occurredAt, timeZone) > todayInTimeZone(this.deps.clock.now(), timeZone)
    ) {
      throw new MovementDateInFuture();
    }

    if (input.type === 'transfer' || input.type === 'exchange') {
      return this.deps.movements.insert(scope, await this.betweenAccounts(scope, input));
    }

    const account = notFoundUnlessAllowed(await this.deps.accounts.find(scope, input.accountId));
    if (account.archived) throw new MovementAccountArchived();

    const category = notFoundUnlessAllowed(
      await this.deps.categories.find(scope, input.categoryId),
    );
    if (category.kind !== input.type) throw new MovementCategoryKindMismatch();
    if (category.archived) throw new CategoryArchived();

    let rate: bigint;
    let rateType: RateType | null;
    if (input.rate.source === 'manual') {
      rate = input.rate.value;
      rateType = null;
    } else {
      const stored = await this.deps.rates.latestSell(defaultRateType);
      if (!stored) throw new RateRequired();
      rate = stored.sell;
      rateType = defaultRateType;
    }

    return this.deps.movements.insert(scope, {
      type: input.type,
      accountId: input.accountId,
      categoryId: input.categoryId,
      amount: input.amount,
      occurredAt: input.occurredAt,
      note: normalizedNote(input.note),
      rate,
      rateSource: input.rate.source,
      rateType,
      tags: input.tags ?? [],
    });
  }

  /** Transfer and exchange rules, in order; reads no stored rate (the rate comes from the amounts). */
  private async betweenAccounts(
    scope: AccessScope<'write'>,
    input: TransferInput | ExchangeInput,
  ): Promise<NewMovement> {
    if (input.accountId === input.destinationAccountId) throw new MovementSameAccount();

    const source = notFoundUnlessAllowed(await this.deps.accounts.find(scope, input.accountId));
    const destination = notFoundUnlessAllowed(
      await this.deps.accounts.find(scope, input.destinationAccountId),
    );
    if (source.archived || destination.archived) throw new MovementAccountArchived();

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
}
