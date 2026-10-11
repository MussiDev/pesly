import { notFoundUnlessAllowed, ResourceNotFound, type AccessScope } from '../../shared/access';
import type { CreditCard, DebitLink } from '../domain/credit-card';
import {
  DebitAccountArchived,
  DebitAccountCurrencyMismatch,
  DebitAccountIsCardAccount,
} from '../domain/errors';
import type { Currency } from '../domain/statement-payment';
import { todayOf, type CreditCardDependencies } from './dependencies';

export type DebitAccountChoice = Record<Currency, string | null>;

const CURRENCIES: readonly Currency[] = ['ARS', 'USD'];

export class SetCardDebitAccounts {
  constructor(
    private readonly deps: Pick<
      CreditCardDependencies,
      'cards' | 'debitAccounts' | 'timeZones' | 'clock'
    >,
  ) {}

  /**
   * Replaces the card's automatic debit setting. Both currencies are validated before anything
   * is written; an unchanged account keeps its link date, a new one starts today (spec D3, D6).
   */
  async execute(
    scope: AccessScope<'write'>,
    cardId: string,
    choice: DebitAccountChoice,
  ): Promise<CreditCard> {
    const card = notFoundUnlessAllowed(await this.deps.cards.findById(scope, cardId));
    const today = await todayOf(this.deps, scope.userId);
    const links: CreditCard['debitAccounts'] = { ARS: null, USD: null };
    for (const currency of CURRENCIES) {
      links[currency] = await this.resolve(scope, card, currency, choice[currency], today);
    }
    const saved = await this.deps.cards.updateDebitAccounts(scope, cardId, links);
    if (!saved) throw new ResourceNotFound();
    return saved;
  }

  private async resolve(
    scope: AccessScope<'write'>,
    card: CreditCard,
    currency: Currency,
    accountId: string | null,
    today: string,
  ): Promise<DebitLink | null> {
    if (accountId === null) return null;
    if (
      accountId === card.arsAccountId ||
      accountId === card.usdAccountId ||
      (await this.deps.cards.isCardAccount(scope, accountId))
    ) {
      throw new DebitAccountIsCardAccount();
    }
    const account = notFoundUnlessAllowed(await this.deps.debitAccounts.find(scope, accountId));
    if (account.currency !== currency) throw new DebitAccountCurrencyMismatch();
    const current = card.debitAccounts[currency];
    const unchanged = current?.accountId === accountId;
    if (account.archived && !unchanged) throw new DebitAccountArchived();
    return { accountId, linkedOn: unchanged ? current.linkedOn : today };
  }
}
