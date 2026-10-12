import { test, expect, type CDPSession } from '@playwright/test';
import { attachThrottling, median, type CdpSender } from './support/lab-profile';
import { expectReady, seedDashboardUser, stubDashboard } from './support/dashboard';
import { resetAttemptLimits } from './support/database';
import { requireProductionBuild } from './support/offline-visit';

// NFR-01 / D12: the production build under the reference profile (Chromium, 10 Mbps, 50 ms,
// CPU slowed 4x); the median of 5 runs of the largest contentful paint must stay under 2.5 s.
// `GET /dashboard` is served by `stubDashboard` and is not throttled (a fulfilled route never
// touches the network); the page, its scripts and `GET /reports/net-worth` are.
// TODO(09b): once the real endpoint exists, measure it too by dropping the stub.

const RUNS = 5;
const LCP_BUDGET_MS = 2500;

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

test.beforeAll(() => {
  // A dev server is slower than the product and would fail for the wrong reason.
  requireProductionBuild();
});

test('the median largest contentful paint of the home over 5 runs is below 2.5 s (NFR-01)', async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  await resetAttemptLimits();
  await stubDashboard(page);
  await seedDashboardUser(page, 'dashboard-lcp');

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
      await page.goto('/es', { waitUntil: 'load' });
      await expectReady(page);
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
