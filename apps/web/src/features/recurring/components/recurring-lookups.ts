/** Names for the ids a recurring payment carries; an id that is not here shows as unknown. */
export interface RecurringLookups {
  accounts: Record<string, { name: string; currency: 'ARS' | 'USD' }>;
  categories: Record<string, string>;
}
