import { expect, test } from '@playwright/test';
import { registerAndVerify, signIn, uniqueEmail } from './support/accounts';
import { resetAttemptLimits } from './support/database';
import {
  ACCOUNT_NAME,
  ACCOUNT_OPTION,
  TAG,
  WEB_URL,
  es,
  prepareOnlineVisit,
  requireProductionBuild,
  t,
  trackSameOriginFailures,
} from './support/offline-visit';

const OFFLINE_ENTRY_BUDGET_MS = 1000;

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

// The service worker is only built into a production build; a dev server would pass for the wrong
// reason, so the run fails before it starts instead.
test.beforeAll(() => {
  requireProductionBuild();
});

test.beforeEach(async () => {
  await resetAttemptLimits();
});

test('starts offline from the cached shell with the cached account and tags, fast and with no failed request (NFR-01, NFR-02, AC-04)', async ({
  page,
  context,
}) => {
  await prepareOnlineVisit(page, 'offline-entry');

  const scope = await page.evaluate(async () => {
    const found = await navigator.serviceWorker.getRegistration('/');
    return found?.scope ?? null;
  });
  expect(scope).toBe(`${WEB_URL}/`);

  const failures = trackSameOriginFailures(page);
  await context.setOffline(true);

  const client = await context.newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const started = Date.now();
  await page.goto('/es/movements/new');
  await expect(page.getByLabel(t.fields.amount, { exact: true })).toBeVisible();
  const elapsed = Date.now() - started;
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  expect(elapsed).toBeLessThan(OFFLINE_ENTRY_BUDGET_MS);

  await expect(
    page
      .getByLabel(t.fields.account, { exact: true })
      .getByRole('option', { name: ACCOUNT_OPTION }),
  ).toHaveCount(1);
  await page.getByLabel(t.tags.label, { exact: true }).fill('vi');
  await expect(
    page.getByRole('list', { name: t.tags.suggestions }).getByRole('button', { name: TAG }),
  ).toBeVisible();

  expect(failures).toEqual([]);
});

test('offline, the list shows the 100 most recent of the 120 seeded movements (AC-02)', async ({
  page,
  context,
}) => {
  await prepareOnlineVisit(page, 'offline-list');
  const failures = trackSameOriginFailures(page);
  await context.setOffline(true);

  await page.goto('/es/movements');

  await expect(page.getByText(t.list.offlineNotice)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: ACCOUNT_NAME })).toHaveCount(100);
  expect(failures).toEqual([]);
});

for (const outcome of ['denies', 'grants'] as const) {
  test(`a browser that ${outcome} persistent storage ${outcome === 'denies' ? 'shows' : 'hides'} the warning, with no console error (AC-06)`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
        errors.push(message.text());
      }
    });
    const grant = outcome === 'grants';
    await page.addInitScript((granted: boolean) => {
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: {
          persisted: () => Promise.resolve(false),
          persist: () => Promise.resolve(granted),
        },
      });
    }, grant);

    const email = uniqueEmail(`storage-${outcome}`);
    await registerAndVerify(page, email);
    await signIn(page, email);
    await expect(page).toHaveURL(/\/es$/);

    const warning = page.getByText(es.app.storageWarning);
    if (grant) {
      await page.waitForLoadState('networkidle');
      await expect(warning).toHaveCount(0);
    } else {
      await expect(warning).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}
