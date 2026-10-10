import { notFoundUnlessAllowed, ResourceNotFound, type AccessScope } from '../../shared/access';
import { AccountHasMovements, AccountLinkedToCard } from '../domain/errors';
import type { AccountLinks } from './ports/account-links';
import type { AccountMovements } from './ports/account-movements';
import type { AccountRepository } from './ports/account-repository';

export interface DeleteAccountDependencies {
  accounts: AccountRepository;
  movements: AccountMovements;
  links: AccountLinks;
}

export class DeleteAccount {
  constructor(private readonly deps: DeleteAccountDependencies) {}

  /**
   * Missing or foreign: `ResourceNotFound`. Linked to a credit card: `AccountLinkedToCard`, row
   * kept. With movements: `AccountHasMovements`, row kept. A foreign-key violation raised by the
   * repository (a card or a movement created in between) propagates as the matching error.
   */
  async execute(scope: AccessScope<'write'>, id: string): Promise<void> {
    notFoundUnlessAllowed(await this.deps.accounts.findById(scope, id));
    if (await this.deps.links.isLinked(id)) throw new AccountLinkedToCard();
    if (await this.deps.movements.hasMovements(id)) throw new AccountHasMovements();
    const deleted = await this.deps.accounts.delete(scope, id);
    if (!deleted) throw new ResourceNotFound();
  }
}
