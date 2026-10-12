import type { AccountResponse } from '@pesly/shared';
import type { ApiClient, ApiResult } from '@/lib/api-client';

export interface ReportAccountOption {
  id: string;
  label: string;
}

const PAGE_SIZE = 100;

/** Every page of one list; an empty page ends the loop even on a stale total. */
async function loadAll(
  api: Pick<ApiClient, 'listAccounts'>,
  archived: boolean,
): Promise<ApiResult<AccountResponse[]>> {
  const items: AccountResponse[] = [];
  for (;;) {
    const page = await api.listAccounts({
      archived,
      limit: PAGE_SIZE,
      ...(items.length > 0 ? { offset: items.length } : {}),
    });
    if (!page.ok) return page;
    items.push(...page.data.items);
    if (page.data.items.length === 0 || items.length >= page.data.total) {
      return { ok: true, data: items };
    }
  }
}

/**
 * The account selector's options: active accounts first, then archived ones (an old movement may
 * still belong to one). A failed call leaves the selector without options; the filter stays usable
 * by tag and the report is not blocked.
 */
export async function loadAccountOptions(
  api: Pick<ApiClient, 'listAccounts'>,
  archivedLabel: (name: string) => string,
): Promise<ReportAccountOption[]> {
  const [active, archived] = await Promise.all([loadAll(api, false), loadAll(api, true)]);
  if (!active.ok || !archived.ok) return [];
  return [
    ...active.data.map((account) => ({ id: account.id, label: account.name })),
    ...archived.data.map((account) => ({ id: account.id, label: archivedLabel(account.name) })),
  ];
}
