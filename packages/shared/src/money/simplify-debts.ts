/** One payment of the simplified settlement plan: `from` pays `amount` minor units to `to`. */
export interface DebtPayment {
  from: string;
  to: string;
  amount: bigint;
}

interface Party {
  memberId: string;
  /** Remaining amount, always positive. */
  amount: bigint;
}

/** Largest amount first, then member id ascending, so the plan never depends on insertion order. */
function byAmountThenId(a: Party, b: Party): number {
  if (a.amount !== b.amount) return a.amount > b.amount ? -1 : 1;
  if (a.memberId === b.memberId) return 0;
  return a.memberId < b.memberId ? -1 : 1;
}

/**
 * Turns the balances of one currency (positive: the group owes the member) into payments that
 * clear all of them. Debtors and creditors with the same amount are matched first; then the
 * largest debtor pays the largest creditor until everything is 0. The result has at most
 * `non-zero members - 1` payments and is deterministic. It is a greedy plan, not the exact
 * minimum (that problem is NP-hard). The balances must add up to 0.
 */
export function simplifyDebts(balances: ReadonlyMap<string, bigint>): DebtPayment[] {
  let total = 0n;
  const debtors: Party[] = [];
  const creditors: Party[] = [];
  for (const [memberId, balance] of balances) {
    total += balance;
    if (balance < 0n) debtors.push({ memberId, amount: -balance });
    else if (balance > 0n) creditors.push({ memberId, amount: balance });
  }
  if (total !== 0n) throw new RangeError('The balances must add up to 0');
  debtors.sort(byAmountThenId);
  creditors.sort(byAmountThenId);

  const payments: DebtPayment[] = [];

  for (const debtor of debtors) {
    const index = creditors.findIndex((creditor) => creditor.amount === debtor.amount);
    if (index === -1) continue;
    const [creditor] = creditors.splice(index, 1);
    if (creditor === undefined) continue;
    payments.push({ from: debtor.memberId, to: creditor.memberId, amount: debtor.amount });
    debtor.amount = 0n;
  }

  let open = debtors.filter((debtor) => debtor.amount > 0n);
  while (open.length > 0 && creditors.length > 0) {
    open.sort(byAmountThenId);
    creditors.sort(byAmountThenId);
    const debtor = open[0];
    const creditor = creditors[0];
    if (debtor === undefined || creditor === undefined) break;
    const amount = debtor.amount < creditor.amount ? debtor.amount : creditor.amount;
    payments.push({ from: debtor.memberId, to: creditor.memberId, amount });
    debtor.amount -= amount;
    creditor.amount -= amount;
    open = open.filter((party) => party.amount > 0n);
    if (creditor.amount === 0n) creditors.shift();
  }

  const remaining = new Map(balances);
  for (const { from, to, amount } of payments) {
    remaining.set(from, (remaining.get(from) ?? 0n) + amount);
    remaining.set(to, (remaining.get(to) ?? 0n) - amount);
  }
  for (const value of remaining.values()) {
    if (value !== 0n) throw new Error('The payments do not clear every balance');
  }
  return payments;
}
