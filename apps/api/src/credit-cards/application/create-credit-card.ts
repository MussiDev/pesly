import { firstOpenPeriod, statementDatesFor } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { CreditCard } from '../domain/credit-card';
import { todayOf, type CreditCardDependencies } from './dependencies';
import type { CardDays } from './ports/credit-card-repository';

export class CreateCreditCard {
  constructor(
    private readonly deps: Pick<CreditCardDependencies, 'cards' | 'timeZones' | 'clock'>,
  ) {}

  /** The card, its linked accounts and the cycle open today are created together (FR-01 to FR-03). */
  async execute(
    scope: AccessScope<'write'>,
    data: CardDays & { name: string },
  ): Promise<CreditCard> {
    const today = await todayOf(this.deps, scope.userId);
    const period = firstOpenPeriod(today, data.closingDay);
    const { card } = await this.deps.cards.create(scope, {
      ...data,
      firstStatement: { period, ...statementDatesFor(period, data.closingDay, data.dueDay) },
    });
    return card;
  }
}
