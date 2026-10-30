/** Where this device remembers the account of the last movement saved, per user. */
const KEY_PREFIX = 'pesly.lastAccount.';

/** Blocked storage (private mode) only means no account is remembered. */
export function readLastAccount(userId: string | undefined): string | undefined {
  if (userId === undefined) return undefined;
  try {
    return window.localStorage.getItem(`${KEY_PREFIX}${userId}`) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeLastAccount(userId: string | undefined, accountId: string): void {
  if (userId === undefined) return;
  try {
    window.localStorage.setItem(`${KEY_PREFIX}${userId}`, accountId);
  } catch {
    // Not remembering the account only costs a tap next time.
  }
}

/**
 * The account a new movement starts on: the last one used when it is still offered, else the
 * first peso account, else the first one at all.
 */
export function startingAccount(
  accounts: readonly { id: string; currency: string }[],
  lastUsed: string | undefined,
): string | undefined {
  if (lastUsed !== undefined && accounts.some((account) => account.id === lastUsed)) {
    return lastUsed;
  }
  return (accounts.find((account) => account.currency === 'ARS') ?? accounts[0])?.id;
}
