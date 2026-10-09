import { type AccountResponse, type CategoryLanguage, type CategoryResponse } from '@pesly/shared';
import { categoryLabel } from '@/features/categories/category-display';
import { loadAll } from '@/features/movements/use-movement-form-data';
import type { ApiClient, ApiResult } from '@/lib/api-client';
import type { RecurringFormOption } from './components/recurring-payment-form';
import type { RecurringLookups } from './components/recurring-lookups';

/** The API's largest page; the loader keeps asking until `total` is reached. */
const PAGE_SIZE = 100;

export interface RecurringReferenceData {
  accounts: AccountResponse[];
  categories: CategoryResponse[];
}

/** The open accounts and open expense categories a recurring payment can point at. */
export async function loadReferenceData(
  api: ApiClient,
): Promise<ApiResult<RecurringReferenceData>> {
  const [accounts, categories] = await Promise.all([
    loadAll((offset) =>
      api.listAccounts({ archived: false, limit: PAGE_SIZE, ...(offset > 0 ? { offset } : {}) }),
    ),
    loadAll((offset) =>
      api.listCategories({
        kind: 'expense',
        archived: false,
        limit: PAGE_SIZE,
        ...(offset > 0 ? { offset } : {}),
      }),
    ),
  ]);
  if (!accounts.ok) return accounts;
  if (!categories.ok) return categories;
  return { ok: true, data: { accounts: accounts.data, categories: categories.data } };
}

export function lookupsOf(
  data: RecurringReferenceData,
  language: CategoryLanguage,
): RecurringLookups {
  return {
    accounts: Object.fromEntries(
      data.accounts.map((account) => [
        account.id,
        { name: account.name, currency: account.currency },
      ]),
    ),
    categories: Object.fromEntries(
      data.categories.map((category) => [category.id, categoryLabel(category, language)]),
    ),
  };
}

export function accountOptions(data: RecurringReferenceData): RecurringFormOption[] {
  return data.accounts.map((account) => ({
    id: account.id,
    label: `${account.name} (${account.currency})`,
  }));
}

export function categoryOptions(
  data: RecurringReferenceData,
  language: CategoryLanguage,
): RecurringFormOption[] {
  return data.categories.map((category) => ({
    id: category.id,
    label: categoryLabel(category, language),
  }));
}
