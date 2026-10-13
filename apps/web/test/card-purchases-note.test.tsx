// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import { CardPurchasesNote } from '../src/components/card-purchases-note';
import { CategoriesContainer } from '../src/features/reports/categories/categories-container';
import { IncomeExpensesContainer } from '../src/features/reports/income-expenses/income-expenses-container';
import { renderApp, stubApi, type TestLocale } from './support/render-app';

const CATEGORIES = 'GET /reports/expenses-by-category';
const INCOME_EXPENSES = 'GET /reports/income-expenses';
const ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';

const categoriesAnswer = {
  status: 200,
  body: {
    currency: 'ARS',
    from: '2026-10-01',
    to: '2026-10-12',
    total: '3000000',
    categories: [{ categoryId: ID, name: null, defaultKey: 'food', amount: '3000000' }],
    unconvertedShareCount: 0,
    unconvertedInstallmentCount: 0,
  },
};

const incomeExpensesAnswer = {
  status: 200,
  body: {
    currency: 'ARS',
    from: '2026-09-01',
    to: '2026-10-31',
    months: [
      { month: '2026-09', income: '0', expenses: '0' },
      { month: '2026-10', income: '0', expenses: '3000000' },
    ],
    unconvertedShareCount: 0,
    unconvertedInstallmentCount: 0,
  },
};

const note = () => document.querySelector('[data-slot="card-purchases-note"]');

describe('CardPurchasesNote', () => {
  it.each([
    ['en', en.cardPurchasesNote.text],
    ['es', es.cardPurchasesNote.text],
  ] as const)('reads its text from the %s catalog (AC-13)', (locale, text) => {
    renderApp(<CardPurchasesNote />, { locale });

    expect(screen.getByText(text)).toBeTruthy();
  });

  it('has a non-empty text in both catalogs, so a missing or empty key fails here (AC-13)', () => {
    expect(en.cardPurchasesNote.text.trim()).not.toBe('');
    expect(es.cardPurchasesNote.text.trim()).not.toBe('');
    expect(Object.keys(en.cardPurchasesNote)).toEqual(Object.keys(es.cardPurchasesNote));
  });

  it('makes no request of its own (AC-17)', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    renderApp(<CardPurchasesNote />, { locale: 'en' });

    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the note on the report screens', () => {
  it.each<[TestLocale, string]>([
    ['en', en.cardPurchasesNote.text],
    ['es', es.cardPurchasesNote.text],
  ])('shows it on the expenses by category report in %s (AC-13)', async (locale, text) => {
    stubApi({ [CATEGORIES]: categoriesAnswer });
    renderApp(<CategoriesContainer />, {
      locale,
      pathname: `/${locale}/reports/categories`,
    });

    expect(await screen.findByText(text)).toBeTruthy();
  });

  it.each<[TestLocale, string]>([
    ['en', en.cardPurchasesNote.text],
    ['es', es.cardPurchasesNote.text],
  ])('shows it on the income and expenses report in %s (AC-13)', async (locale, text) => {
    stubApi({ [INCOME_EXPENSES]: incomeExpensesAnswer });
    renderApp(<IncomeExpensesContainer />, {
      locale,
      pathname: `/${locale}/reports/income-expenses`,
    });

    expect(await screen.findByText(text)).toBeTruthy();
  });

  it('loads the income and expenses report with the same single request as before (AC-17)', async () => {
    const { calls } = stubApi({ [INCOME_EXPENSES]: incomeExpensesAnswer });
    renderApp(<IncomeExpensesContainer />, {
      locale: 'en',
      pathname: '/en/reports/income-expenses',
    });
    await screen.findByText(en.cardPurchasesNote.text);

    expect(calls.filter((call) => call.path.startsWith('/reports/'))).toHaveLength(1);
  });

  it('shows no note when the report fails with an error, because there are no figures to explain', async () => {
    stubApi({ [CATEGORIES]: { status: 500 } });
    renderApp(<CategoriesContainer />, {
      locale: 'en',
      pathname: '/en/reports/categories',
    });

    await screen.findByRole('alert');
    expect(note()).toBeNull();
  });

  it('loads the report with the same single request as before (AC-17)', async () => {
    const { calls } = stubApi({ [CATEGORIES]: categoriesAnswer });
    renderApp(<CategoriesContainer />, {
      locale: 'en',
      pathname: '/en/reports/categories',
    });
    await screen.findByText(en.cardPurchasesNote.text);

    const reportCalls = calls.filter((call) => call.path.startsWith('/reports/'));
    expect(reportCalls).toHaveLength(1);
  });
});
