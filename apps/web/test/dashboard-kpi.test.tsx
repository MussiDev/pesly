// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeltaChip } from '../src/features/dashboard/components/delta-chip';
import { KpiCards } from '../src/features/dashboard/components/kpi-cards';
import { MonthNotice } from '../src/features/dashboard/components/month-notice';
import type { MonthView } from '../src/features/dashboard/dashboard-view';
import { CATALOGS, renderApp } from './support/render-app';

const { es, en } = CATALOGS;
const MINUS = '−';

function month(overrides: Partial<MonthView> = {}): MonthView {
  return {
    expenses: { value: 24000000n, change: 20 },
    income: { value: 80000000n, change: 20 },
    net: { value: 56000000n, change: -5 },
    leftOutCount: 0,
    ...overrides,
  };
}

const flat = (value: string) => value.replace(/\s+/g, ' ');
const text = () => flat(document.body.textContent);
const chips = () => [...document.querySelectorAll<HTMLElement>('[data-slot="badge"]')];

describe('KpiCards', () => {
  it('shows October expenses, income and net result in ARS (AC-06)', () => {
    renderApp(<KpiCards locale="en" currency="ARS" month={month()} />, { locale: 'en' });
    expect(text()).toContain('240,000.00 ARS');
    expect(text()).toContain('800,000.00 ARS');
    expect(text()).toContain('560,000.00 ARS');
    expect(text()).toContain(en.dashboard.month.expenses);
    expect(text()).toContain(en.dashboard.month.income);
    expect(text()).toContain(en.dashboard.month.net);
  });

  it('prints a negative net result with a minus sign (AC-07)', () => {
    renderApp(
      <KpiCards
        locale="en"
        currency="ARS"
        month={month({ net: { value: -1500000n, change: null } })}
      />,
      { locale: 'en' },
    );
    expect(text()).toContain('-15,000.00 ARS');
  });

  it('prints zero with no sign and a null change without NaN (invalid input)', () => {
    renderApp(
      <KpiCards
        locale="en"
        currency="ARS"
        month={month({ expenses: { value: 0n, change: null } })}
      />,
      { locale: 'en' },
    );
    expect(text()).toContain('0.00 ARS');
    expect(text()).not.toContain('-0.00');
    expect(text()).not.toContain('NaN');
  });

  it('prints an out-of-range change as received and lets it wrap (invalid input)', () => {
    renderApp(
      <KpiCards
        locale="en"
        currency="ARS"
        month={month({ expenses: { value: 100n, change: 100000 } })}
      />,
      { locale: 'en' },
    );
    expect(text()).toContain('+100,000%');
    expect(chips()[0]?.className).toContain('whitespace-normal');
  });

  it('prints the three amounts in USD when it is the display currency (AC-50)', () => {
    renderApp(<KpiCards locale="en" currency="USD" month={month()} />, { locale: 'en' });
    expect(text()).toContain('240,000.00 USD');
    expect(text()).not.toContain('ARS');
  });

  it('has an accessible name per card and no interactive element (NFR-08)', () => {
    renderApp(<KpiCards locale="en" currency="ARS" month={month()} />, { locale: 'en' });
    for (const label of [
      en.dashboard.month.expenses,
      en.dashboard.month.income,
      en.dashboard.month.net,
    ]) {
      expect(screen.getByRole('group', { name: label })).toBeTruthy();
    }
    expect(document.querySelectorAll('a,button,input,select,[tabindex]').length).toBe(0);
    expect(document.querySelectorAll('[aria-hidden="true"]').length).toBe(0);
  });

  it('keeps every card shrinkable and in one row from sm', () => {
    renderApp(<KpiCards locale="en" currency="ARS" month={month()} />, { locale: 'en' });
    const cards = document.querySelectorAll('[data-slot="card"]');
    expect(cards.length).toBe(3);
    for (const card of cards) expect(card.className).toContain('min-w-0');
    expect(cards[0]?.parentElement?.className).toContain('sm:grid-cols-3');
  });

  it('renders Spanish strings and amounts (AC-47)', () => {
    renderApp(<KpiCards locale="es" currency="ARS" month={month()} />, { locale: 'es' });
    expect(text()).toContain('240.000,00 ARS');
    expect(text()).toContain(es.dashboard.month.expenses);
    expect(text()).toContain(es.dashboard.month.comparison);
  });
});

describe('DeltaChip', () => {
  it('reads +20% Unfavorable for expenses and +20% Favorable for income (AC-08)', () => {
    renderApp(
      <>
        <DeltaChip change={20} kind="expense" locale="en" />
        <DeltaChip change={20} kind="income" locale="en" />
      </>,
      { locale: 'en' },
    );
    const [expense, income] = chips().map((chip) => flat(chip.textContent));
    expect(expense).toContain('+20%');
    expect(expense).toContain(en.dashboard.delta.unfavorable);
    expect(income).toContain('+20%');
    expect(income).toContain(en.dashboard.delta.favorable);
  });

  it('reads a dash and the no-comparison word for a null change (AC-09)', () => {
    renderApp(<DeltaChip change={null} kind="net" locale="en" />, { locale: 'en' });
    const chip = chips()[0];
    expect(chip?.textContent).toContain('—');
    expect(chip?.textContent).toContain(en.dashboard.delta.noComparison);
    expect(chip?.textContent).not.toContain('NaN');
  });

  it('uses the success, destructive and outline variants', () => {
    renderApp(
      <>
        <DeltaChip change={5} kind="income" locale="en" />
        <DeltaChip change={5} kind="expense" locale="en" />
        <DeltaChip change={0} kind="net" locale="en" />
        <DeltaChip change={null} kind="net" locale="en" />
      </>,
      { locale: 'en' },
    );
    const [fav, unfav, zero, none] = chips();
    expect(fav?.className).toContain('text-success');
    expect(unfav?.className).toContain('text-destructive');
    expect(zero?.className).toContain('bg-card');
    expect(none?.className).toContain('bg-card');
    expect(zero?.textContent).toContain('0%');
    expect(zero?.textContent).toContain(en.dashboard.delta.noChange);
  });

  it('carries a sign or a word in every variant without any stylesheet (NFR-04)', () => {
    const words = Object.values(en.dashboard.delta);
    for (const kind of ['expense', 'income', 'net'] as const) {
      for (const change of [20, -5, 0, null]) {
        const html = renderToStaticMarkup(
          <NextIntlClientProvider locale="en" messages={en}>
            <DeltaChip change={change} kind={kind} locale="en" />
          </NextIntlClientProvider>,
        );
        const visible = html.replace(/<[^>]*>/g, '');
        expect(
          words.some((word) => visible.includes(word)),
          `${kind} ${change}`,
        ).toBe(true);
        expect(/[+−—]|0%/.test(visible), `${kind} ${change}`).toBe(true);
        expect(html).not.toContain('aria-hidden');
      }
    }
  });

  it('reads the negative sign and the right word for each kind', () => {
    renderApp(
      <>
        <DeltaChip change={-5} kind="expense" locale="en" />
        <DeltaChip change={-5} kind="net" locale="en" />
      </>,
      { locale: 'en' },
    );
    const [expense, net] = chips().map((chip) => chip.textContent);
    expect(expense).toContain(`${MINUS}5%`);
    expect(expense).toContain(en.dashboard.delta.favorable);
    expect(net).toContain(en.dashboard.delta.unfavorable);
  });

  it('renders Spanish words (AC-47)', () => {
    renderApp(<DeltaChip change={20} kind="expense" locale="es" />, { locale: 'es' });
    expect(text()).toContain(es.dashboard.delta.unfavorable);
  });
});

describe('MonthNotice', () => {
  it('shows the count and the reason when shares are left out (AC-32)', () => {
    renderApp(<MonthNotice count={3} />, { locale: 'en' });
    const note = screen.getByRole('note');
    expect(within(note).getByText(/3 shares or installments are left out/)).toBeTruthy();
    expect(note.textContent).toContain(en.dashboard.month.leftOutReason);
  });

  it('shows nothing and no error for a count of 0 (AC-32)', () => {
    const { container } = renderApp(<MonthNotice count={0} />, { locale: 'en' });
    expect(container.textContent).toBe('');
  });

  it('renders in Spanish', () => {
    renderApp(<MonthNotice count={1} />, { locale: 'es' });
    expect(text()).toContain(es.dashboard.month.leftOutReason);
  });
});
