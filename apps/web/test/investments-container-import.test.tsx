// @vitest-environment happy-dom
import type { ImportHolding, PortfolioResponse } from '@pesly/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BalanzParseError } from '../src/features/investments/balanz-import/balanz-types';
import { parseBalanzXlsx } from '../src/features/investments/balanz-import/parse-balanz-xlsx';
import { InvestmentsContainer } from '../src/features/investments/containers/investments-container';
import { HOLDING } from './support/holding-fixture';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

vi.mock('../src/features/investments/balanz-import/parse-balanz-xlsx', () => ({
  parseBalanzXlsx: vi.fn(),
}));

const inv = CATALOGS.es.investments;
const t = inv.import;
const PORTFOLIO_ID = HOLDING.portfolioId;
const LIST = 'GET /investments/portfolios';
const IMPORT = `POST /investments/portfolios/${PORTFOLIO_ID}/holdings/import`;

const portfolio = (holdings = [HOLDING]): PortfolioResponse => ({
  id: PORTFOLIO_ID,
  name: 'Balanz',
  createdAt: '2026-08-01T10:00:00.000Z',
  totals: [],
  holdingsWithoutPrice: 0,
  holdings,
});
const list = (...portfolios: PortfolioResponse[]) => ({ status: 200, body: { portfolios } });
const session = {
  status: 200,
  body: {
    user: { id: 'u1', email: 'a@b.test', emailVerified: true, language: 'es', timeZone: 'UTC' },
  },
};

const row = (ticker: string): ImportHolding => ({
  ticker,
  instrumentName: `${ticker} CEDEAR`,
  instrumentType: 'cedear',
  valuationCurrency: 'ARS',
  quantity: '4600000000',
  totalCost: '41949600',
  unitPrice: '753500',
  pricedOn: '2026-10-09',
});

const importAnswer = {
  status: 200,
  body: { created: 2, updated: 0, removed: 1, portfolio: portfolio([]) },
};

const parse = vi.mocked(parseBalanzXlsx);

beforeEach(() => {
  parse.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function openImport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', { name: t.actionFor.replace('{name}', 'Balanz') }),
  );
}

async function chooseFile(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText(t.fileLabel), new File(['x'], 'holdings.xlsx'));
}

describe('InvestmentsContainer import (DISC-001-07c)', () => {
  it('shows the preview without calling the API, then imports the chosen currencies (AC-02, AC-03, AC-09)', async () => {
    parse.mockResolvedValue([row('IBIT'), row('SPY')]);
    const { calls } = stubApi({
      'GET /auth/session': session,
      [LIST]: [list(portfolio()), list(portfolio([]))],
      [IMPORT]: importAnswer,
    });
    renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    await openImport(user);
    await chooseFile(user);

    expect(
      await screen.findByText('2 para agregar, 0 para actualizar, 1 para quitar.'),
    ).toBeDefined();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    await user.selectOptions(screen.getByLabelText('Moneda de SPY'), 'USD');
    await user.click(screen.getByRole('button', { name: t.confirm }));

    expect(
      await screen.findByText('Importado: 2 agregadas, 0 actualizadas, 1 quitadas.'),
    ).toBeDefined();
    const sent = calls.find((call) => call.method === 'POST')?.body as {
      holdings: ImportHolding[];
    };
    expect(sent.holdings.map((holding) => [holding.ticker, holding.valuationCurrency])).toEqual([
      ['IBIT', 'ARS'],
      ['SPY', 'USD'],
    ]);
    expect(Object.keys(sent)).toEqual(['holdings']);
    expect(screen.queryByLabelText(t.fileLabel)).toBeNull();
  });

  it('leaves the portfolio untouched and drops the rows when the preview is cancelled (AC-04)', async () => {
    parse.mockResolvedValue([row('IBIT')]);
    const { calls } = stubApi({
      'GET /auth/session': session,
      [LIST]: list(portfolio()),
    });
    renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    await openImport(user);
    await chooseFile(user);
    await screen.findByRole('button', { name: t.confirm });
    await user.click(screen.getByRole('button', { name: t.cancel }));

    expect(screen.queryByLabelText(t.fileLabel)).toBeNull();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    // Opening it again starts empty: nothing of the first file was kept.
    await openImport(user);
    expect(screen.queryByRole('button', { name: t.confirm })).toBeNull();
    expect(screen.queryByText(/para agregar/)).toBeNull();
  });

  it.each([
    ['wrongSheet', undefined, t.errors.wrongSheet],
    ['badRow', '3', 'La fila 3 del archivo no es válida. No se importó nada.'],
    ['notExcel', undefined, t.errors.notExcel],
  ] as const)(
    'rejects a file with reason %s, shows the message and offers no confirm (AC-05, AC-07)',
    async (reason, detail, message) => {
      parse.mockRejectedValue(new BalanzParseError(reason, detail));
      stubApi({ 'GET /auth/session': session, [LIST]: list(portfolio()) });
      renderApp(<InvestmentsContainer />);
      const user = userEvent.setup();

      await openImport(user);
      await chooseFile(user);

      expect((await screen.findByRole('alert')).textContent).toBe(message);
      expect(screen.queryByRole('button', { name: t.confirm })).toBeNull();
    },
  );

  it('rejects a file that repeats a ticker before offering a confirm (AC-05)', async () => {
    parse.mockResolvedValue([row('IBIT'), row('ibit')]);
    stubApi({ 'GET /auth/session': session, [LIST]: list(portfolio()) });
    renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    await openImport(user);
    await chooseFile(user);

    expect((await screen.findByRole('alert')).textContent).toBe(t.errors.duplicateTicker);
    expect(screen.queryByRole('button', { name: t.confirm })).toBeNull();
  });

  it('keeps the preview open with the message when the API refuses the import (AC-05)', async () => {
    parse.mockResolvedValue([row('IBIT')]);
    const { calls } = stubApi({
      'GET /auth/session': session,
      [LIST]: list(portfolio()),
      [IMPORT]: { status: 400, body: { code: 'VALIDATION_FAILED', fields: ['body.holdings'] } },
    });
    renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    await openImport(user);
    await chooseFile(user);
    await user.click(await screen.findByRole('button', { name: t.confirm }));

    expect((await screen.findByRole('alert')).textContent).toBe(t.errors.rejected);
    expect(screen.getByRole('button', { name: t.confirm })).toBeDefined();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('shows a network failure and keeps the rows to retry (AC-05)', async () => {
    parse.mockResolvedValue([row('IBIT')]);
    stubApi({
      'GET /auth/session': session,
      [LIST]: list(portfolio()),
      [IMPORT]: 'network-error',
    });
    renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    await openImport(user);
    await chooseFile(user);
    await user.click(await screen.findByRole('button', { name: t.confirm }));

    expect((await screen.findByRole('alert')).textContent).toBe(inv.errors.network);
    expect(screen.getByRole('button', { name: t.confirm })).toBeDefined();
  });

  it('keeps nothing about the file in browser storage, on confirm or on cancel (AC-06, NFR-02)', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    parse.mockResolvedValue([row('IBIT')]);
    stubApi({
      'GET /auth/session': session,
      [LIST]: [list(portfolio()), list(portfolio([])), list(portfolio([]))],
      [IMPORT]: importAnswer,
    });
    renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    await openImport(user);
    await chooseFile(user);
    await user.click(await screen.findByRole('button', { name: t.cancel }));
    await openImport(user);
    await chooseFile(user);
    await user.click(await screen.findByRole('button', { name: t.confirm }));

    await waitFor(() => {
      expect(screen.queryByLabelText(t.fileLabel)).toBeNull();
    });
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
