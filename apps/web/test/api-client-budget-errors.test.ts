import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike } from '../src/lib/api-client';

function messages(locale: string): { errors: Record<string, string> } {
  const path = fileURLToPath(new URL(`../messages/${locale}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as { errors: Record<string, string> };
}

describe('budget error codes in the web client (AC-04, AC-23)', () => {
  it.each([
    [409, 'BUDGET_LIMIT_REACHED', 'budgetLimitReached'],
    [400, 'BUDGET_CATEGORY_KIND_INVALID', 'budgetCategoryKindInvalid'],
  ])('maps a %i %s answer to its message key', async (status, code, key) => {
    const fetch = vi.fn<FetchLike>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ code }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const client = createApiClient({ baseUrl: 'http://api.argent.test', fetch });

    expect(await client.skipOccurrence('9b1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b')).toMatchObject({
      ok: false,
      code,
      messageKey: key,
    });
  });

  it.each(['en', 'es'])('has both messages in the %s catalog', (locale) => {
    const { errors } = messages(locale);
    expect(errors.budgetLimitReached).toBeTruthy();
    expect(errors.budgetCategoryKindInvalid).toBeTruthy();
  });
});
