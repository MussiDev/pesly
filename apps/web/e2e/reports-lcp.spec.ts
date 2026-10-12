import { test, expect, type CDPSession } from '@playwright/test';
import { signIn } from './support/accounts';
import { resetAttemptLimits } from './support/database';
import { attachThrottling, median, type CdpSender } from './support/lab-profile';
import { requireProductionBuild } from './support/offline-visit';
import { REPORT_ROUTE, seedReportsUser, type ReportKey } from './support/reports';
import { es } from './support/dashboard';

// NFR-01: the production build under the reference profile (Chromium, 10 Mbps, 50 ms, CPU slowed
// 4x); the median of 5 runs of the largest contentful paint of each report must stay under
// 2.5 s. The page, its scripts and the report request all go through the throttled network.

const RUNS = 5;
const LCP_BUDGET_MS = 2500;

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

const LISTS: Record<ReportKey, string> = {
  categories: es.reports.categories.listName,
  incomeExpenses: es.reports.incomeExpenses.listName,
  netWorth: es.reports.netWorth.listName,
};

let email = '';

test.beforeAll(async ({ browser }) => {
  // A dev server is slower than the product and would fail for the wrong reason.
  requireProductionBuild();
  test.setTimeout(300_000);
  await resetAttemptLimits();
  const page = await browser.newPage({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
  email = await seedReportsUser(page, 'reports-lcp');
  await page.close();
});

for (const key of ['categories', 'incomeExpenses', 'netWorth'] as const) {
  test(`the median largest contentful paint of the ${key} report over 5 runs is below 2.5 s (NFR-01)`, async ({
    page,
    context,
  }) => {
    test.setTimeout(300_000);
    await resetAttemptLimits();
    await signIn(page, email);
    await expect(page).toHaveURL(/\/es$/);

    await page.addInitScript(() => {
      const scope = window as unknown as { __lcp?: number };
      scope.__lcp = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) scope.__lcp = entry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });

    const runs: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      await page.goto('about:blank');
      let raw: CDPSession | undefined;
      try {
        await attachThrottling(async (): Promise<CdpSender> => {
          const session = await context.newCDPSession(page);
          raw = session;
          await session.send('Network.enable');
          await session.send('Network.clearBrowserCache');
          return { send: (method, params) => session.send(method as never, params as never) };
        });
        await page.goto(REPORT_ROUTE[key], { waitUntil: 'load' });
        await expect(page.getByRole('list', { name: LISTS[key] })).toBeVisible();
        await page.waitForLoadState('networkidle');
        const lcp = await page.evaluate(() => (window as unknown as { __lcp?: number }).__lcp ?? 0);
        expect(lcp, `run ${run + 1} recorded no largest contentful paint`).toBeGreaterThan(0);
        runs.push(lcp);
      } finally {
        await raw?.detach();
      }
    }

    const middle = median(runs);
    expect(
      middle,
      `LCP runs (ms): ${runs.map((value) => Math.round(value)).join(', ')}`,
    ).toBeLessThan(LCP_BUDGET_MS);
  });
}
