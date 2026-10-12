// @vitest-environment happy-dom
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IncomeExpensesContainer } from '../src/features/reports/income-expenses/income-expenses-container';
import { renderApp, stubApi } from './support/render-app';

const ZERO = { ARS: '0', USD: '0' };
const CASH = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';

function accounts(items: { id: string; name: string }[]) {
  return {
    status: 200,
    body: {
      items: items.map((item) => ({
        ...item,
        type: 'cash',
        currency: 'ARS',
        openingBalance: '0',
        balance: '0',
        includeInAvailable: true,
        archived: false,
        archivedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      })),
      availableTotals: ZERO,
      netWorthTotals: ZERO,
      debtTotals: ZERO,
      creditCardCount: 0,
      total: items.length,
      limit: 100,
      offset: 0,
    },
  };
}

const options = () =>
  within(screen.getByLabelText('Account'))
    .getAllByRole('option')
    .map((option) => option.textContent);

describe('account options of the report filters (M6)', () => {
  it('loads the options again when the connection returns after a failed first load', async () => {
    stubApi({
      'GET /accounts?archived=false&limit=100': [
        { status: 500 },
        accounts([{ id: CASH, name: 'Cash' }]),
      ],
      'GET /accounts?archived=true&limit=100': [{ status: 500 }, accounts([])],
      'GET /reports/income-expenses': { status: 500 },
    });
    renderApp(<IncomeExpensesContainer />, {
      locale: 'en',
      pathname: '/en/reports/income-expenses',
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Account')).toBeTruthy();
    });
    expect(options()).toEqual(['All accounts']);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(options()).toEqual(['All accounts', 'Cash']);
    });
  });
});
