import { setDebitAccountsRequestSchema, type SetDebitAccountsRequest } from '@pesly/shared';

/** The two selected values; `''` means "no automatic debit in that currency". */
export interface DebitAccountsValues {
  ars: string;
  usd: string;
}

export interface DebitAccountCandidateSource {
  id: string;
  currency: string;
  type: string;
  archived: boolean;
}

const idSchema = setDebitAccountsRequestSchema.shape.debitArsAccountId.unwrap();

/** An id the server could accept, or `null`: anything that is not a UUID is dropped here. */
function toLink(value: string): string | null {
  const parsed = idSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The body of `PUT /credit-cards/:id/debit-accounts`; the server validates it again. */
export function buildDebitAccountsRequest(values: DebitAccountsValues): SetDebitAccountsRequest {
  return { debitArsAccountId: toLink(values.ars), debitUsdAccountId: toLink(values.usd) };
}

/**
 * The accounts offered for the debit of one currency: open, of that currency, and neither a card
 * account nor one of the card's own two accounts, so a currency mismatch cannot be picked (AC-02).
 */
export function debitCandidates<T extends DebitAccountCandidateSource>(
  accounts: readonly T[],
  currency: 'ARS' | 'USD',
  card: { arsAccountId: string; usdAccountId: string },
): T[] {
  return accounts.filter(
    (account) =>
      account.currency === currency &&
      !account.archived &&
      account.type !== 'credit_card' &&
      account.id !== card.arsAccountId &&
      account.id !== card.usdAccountId,
  );
}
