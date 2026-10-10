import type { AccountLinks } from '../../application/ports/account-links';

/** Default when no module links accounts: nothing is linked. */
export class NoLinksAdapter implements AccountLinks {
  isLinked(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
