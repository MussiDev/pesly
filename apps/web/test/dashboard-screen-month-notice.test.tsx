// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DashboardScreen } from '../src/features/dashboard/components/dashboard-screen';
import type { DashboardView } from '../src/features/dashboard/dashboard-view';
import { CATALOGS, renderApp } from './support/render-app';

const { en } = CATALOGS;

function view(leftOutCount: number): DashboardView {
  return {
    currency: 'ARS',
    netWorth: { total: 1000n, reason: null, ars: 1000n, usd: 0n, holdingsWithoutPrice: 0 },
    month: {
      expenses: { value: 100n, change: null },
      income: { value: 200n, change: null },
      net: { value: 100n, change: null },
      leftOutCount,
    },
    categories: [],
    budgets: [],
    upcoming: [],
    actions: [],
    groups: { owedToYou: { ARS: 0n, USD: 0n }, youOwe: { ARS: 0n, USD: 0n } },
    insight: null,
    firstSteps: { hasAccount: true, hasMovement: true, show: false },
  };
}

function renderScreen(leftOutCount: number) {
  return renderApp(
    <DashboardScreen
      locale="en"
      view={view(leftOutCount)}
      series={{ kind: 'ready', currency: 'ARS', points: [] }}
      attention={[]}
    />,
    { locale: 'en' },
  );
}

describe('DashboardScreen month notice (FR-16, AC-32)', () => {
  it('says how many shares or installments are left out of the month', () => {
    const { container } = renderScreen(3);
    expect(container.textContent).toContain('3 shares or installments are left out.');
    expect(container.textContent).toContain(en.dashboard.month.leftOutReason);
    const kpis = container.querySelector('[data-dashboard-slot="kpis"]');
    expect(kpis?.querySelector('[role="note"]')).not.toBeNull();
  });

  it('renders nothing when none is left out', () => {
    const { container } = renderScreen(0);
    expect(container.querySelector('[role="note"]')).toBeNull();
  });
});
