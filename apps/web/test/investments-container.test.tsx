// @vitest-environment happy-dom
import type { HoldingResponse, PortfolioResponse } from '@pesly/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InvestmentsContainer } from '../src/features/investments/containers/investments-container';
import { formatDateTime } from '../src/lib/format-amount';
import { HOLDING } from './support/holding-fixture';
import { API_ORIGIN, CATALOGS, renderApp, stubApi } from './support/render-app';

const { es } = CATALOGS;
const inv = es.investments;

const PORTFOLIO_ID = HOLDING.portfolioId;
const SECOND_HOLDING: HoldingResponse = {
  ...HOLDING,
  id: '33333333-3333-4333-8333-333333333333',
  ticker: 'MSFT',
  instrumentName: 'Microsoft',
  quantity: '500000000',
  totalCost: null,
  unitPrice: '2000000',
  value: '10000000',
  gain: null,
};

function portfolio(
  overrides: Partial<PortfolioResponse> = {},
  holdings: HoldingResponse[] = [HOLDING],
): PortfolioResponse {
  const total = holdings.reduce((sum, holding) => sum + BigInt(holding.value ?? '0'), 0n);
  return {
    id: PORTFOLIO_ID,
    name: 'Balanz',
    createdAt: '2026-08-01T10:00:00.000Z',
    totals: holdings.length === 0 ? [] : [{ currency: 'ARS', value: total.toString() }],
    holdingsWithoutPrice: 0,
    holdings,
    ...overrides,
  };
}

function list(...portfolios: PortfolioResponse[]) {
  return { status: 200, body: { portfolios } };
}

function session(timeZone = 'UTC') {
  return {
    status: 200,
    body: {
      user: {
        id: 'u1',
        email: 'ana@example.com',
        emailVerified: true,
        language: 'es',
        timeZone,
      },
    },
  };
}

const UNAUTHENTICATED = { status: 401, body: { code: 'UNAUTHENTICATED' } };
const NOT_FOUND = { status: 404, body: { code: 'NOT_FOUND' } };

const LIST = 'GET /investments/portfolios';

function paths(calls: { method: string; path: string }[]) {
  return calls.map((call) => `${call.method} ${call.path}`);
}

function text(element: HTMLElement) {
  return element.textContent.split(String.fromCharCode(160)).join(' ');
}

function totals() {
  return text(screen.getByRole('list', { name: inv.portfolio.totalsLabel }));
}

const OTHER_ID = '44444444-4444-4444-8444-444444444444';

const addFor = (name: string) => inv.portfolio.addHoldingFor.replace('{name}', name);
const deleteFor = (name: string) => inv.portfolio.deleteFor.replace('{name}', name);

/**
 * Holds the requests that `match` selects until the test releases them, in the order they were
 * made; every other request goes straight to the stubbed API.
 */
function gateRequests(
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
  match: (method: string, path: string) => boolean,
) {
  const held: (() => void)[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (!match(init?.method ?? 'GET', url.slice(API_ORIGIN.length))) return fetch(url, init);
    return new Promise<Response>((resolve) => {
      held.push(() => {
        resolve(fetch(url, init));
      });
    });
  });
  return {
    held: () => held.length,
    release(index: number) {
      held[index]?.();
    },
  };
}

/** The add form's submit button; the portfolio openers carry the same name. */
function submitAddButton(): HTMLButtonElement {
  const button = screen
    .getAllByRole<HTMLButtonElement>('button', { name: inv.forms.addHolding.submit })
    .find((candidate) => candidate.type === 'submit');
  if (!button) throw new Error('The add form is not open');
  return button;
}

/** The first button that opens an add form (empty portfolios may show two). */
async function firstOpener(): Promise<HTMLElement> {
  const [first] = await screen.findAllByRole('button', { name: addFor('Balanz') });
  if (!first) throw new Error('No add button');
  return first;
}

async function fillAddForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(inv.forms.addHolding.ticker), 'AAPL');
  await user.type(screen.getByLabelText(inv.forms.addHolding.instrumentName), 'Apple Inc.');
  await user.type(screen.getByLabelText(inv.forms.addHolding.quantity), '5');
}

async function openDetails(ticker: string) {
  await userEvent.setup().click(
    await screen.findByRole('button', {
      name: inv.holding.showDetailsFor.replace('{ticker}', ticker),
    }),
  );
}

describe('InvestmentsContainer', () => {
  it('AC-01: creates a portfolio from the empty state and shows it in the list', async () => {
    const { calls } = stubApi({
      'GET /auth/session': session(),
      [LIST]: [list(), list(portfolio({}, []))],
      'POST /investments/portfolios': { status: 201, body: portfolio({}, []) },
    });
    renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    expect(screen.getByText(es.app.loading)).toBeDefined();
    expect(await screen.findByRole('heading', { name: inv.empty.title })).toBeDefined();
    await user.type(screen.getByLabelText(inv.forms.createPortfolio.name), 'Balanz');
    await user.click(screen.getByRole('button', { name: inv.forms.createPortfolio.submit }));

    expect(await screen.findByRole('heading', { name: 'Balanz' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: inv.empty.title })).toBeNull();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ name: 'Balanz' });
    expect(paths(calls).filter((call) => call === LIST)).toHaveLength(2);
  });

  it('AC-01: creates another portfolio from the button above a non-empty list', async () => {
    const other = portfolio({ id: '44444444-4444-4444-8444-444444444444', name: 'IOL' }, []);
    const { calls } = stubApi({
      'GET /auth/session': session(),
      [LIST]: [list(portfolio()), list(portfolio(), other)],
      'POST /investments/portfolios': { status: 201, body: other },
    });
    renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: inv.forms.createPortfolio.title }));
    await user.type(screen.getByLabelText(inv.forms.createPortfolio.name), 'IOL');
    await user.click(screen.getByRole('button', { name: inv.forms.createPortfolio.submit }));

    expect(await screen.findByRole('heading', { name: 'IOL' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Balanz' })).toBeDefined();
    expect(screen.queryByLabelText(inv.forms.createPortfolio.name)).toBeNull();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ name: 'IOL' });
  });

  it('AC-06: deleting a holding calls the API, reloads the list and updates the total', async () => {
    const { calls } = stubApi({
      'GET /auth/session': session(),
      [LIST]: [list(portfolio({}, [HOLDING, SECOND_HOLDING])), list(portfolio({}, [HOLDING]))],
      [`DELETE /investments/holdings/${SECOND_HOLDING.id}`]: { status: 204 },
    });
    renderApp(<InvestmentsContainer />);

    await openDetails('MSFT');
    expect(totals()).toContain('285.000,00 ARS');
    await userEvent
      .setup()
      .click(
        screen.getByRole('button', { name: inv.holding.deleteFor.replace('{ticker}', 'MSFT') }),
      );

    await waitFor(() => {
      expect(screen.queryByText('MSFT')).toBeNull();
    });
    expect(totals()).toContain('185.000,00 ARS');
    expect(totals()).not.toContain('285.000,00');
    expect(screen.getByRole('status').textContent).toContain(inv.notices.deleted);
    expect(paths(calls)).toEqual([
      'GET /auth/session',
      LIST,
      `DELETE /investments/holdings/${SECOND_HOLDING.id}`,
      LIST,
    ]);
  });

  it('AC-17: deleting a portfolio needs a second confirmation, then removes it with its holdings', async () => {
    const { calls } = stubApi({
      'GET /auth/session': session(),
      [LIST]: [list(portfolio()), list()],
      [`DELETE /investments/portfolios/${PORTFOLIO_ID}`]: { status: 204 },
    });
    renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: deleteFor('Balanz') }));
    expect(screen.getByText(inv.forms.confirmDelete.portfolio)).toBeDefined();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: inv.forms.confirmDelete.confirm }));

    expect(await screen.findByRole('heading', { name: inv.empty.title })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Balanz' })).toBeNull();
    expect(screen.queryByText('AAPL')).toBeNull();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('AC-17: cancelling the confirmation keeps the portfolio and calls nothing', async () => {
    const { calls } = stubApi({ 'GET /auth/session': session(), [LIST]: list(portfolio()) });
    renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: deleteFor('Balanz') }));
    await user.click(screen.getByRole('button', { name: inv.forms.cancel }));

    expect(screen.queryByText(inv.forms.confirmDelete.portfolio)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Balanz' })).toBeDefined();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('AC-16: shows only the portfolios the API returned', async () => {
    const other = portfolio({ id: '44444444-4444-4444-8444-444444444444', name: 'IOL' }, []);
    const { calls } = stubApi({
      'GET /auth/session': session(),
      [LIST]: list(portfolio(), other),
    });
    renderApp(<InvestmentsContainer />);

    expect(await screen.findByRole('heading', { name: 'Balanz' })).toBeDefined();
    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent)
        .sort(),
    ).toEqual(['Balanz', 'IOL']);
    expect(paths(calls).filter((call) => call === LIST)).toHaveLength(1);
  });

  it('AC-23: an add answered as merged shows the merged notice and the summed quantity', async () => {
    const merged: HoldingResponse = { ...HOLDING, quantity: '1500000000' };
    const { calls } = stubApi({
      'GET /auth/session': session(),
      [LIST]: [list(portfolio()), list(portfolio({}, [merged]))],
      [`POST /investments/portfolios/${PORTFOLIO_ID}/holdings`]: {
        status: 200,
        body: { holding: merged, merged: true },
      },
    });
    renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: addFor('Balanz') }));
    await user.type(screen.getByLabelText(inv.forms.addHolding.ticker), 'AAPL');
    await user.type(screen.getByLabelText(inv.forms.addHolding.instrumentName), 'Apple Inc.');
    await user.type(screen.getByLabelText(inv.forms.addHolding.quantity), '5');
    await user.click(screen.getByRole('button', { name: inv.forms.addHolding.submit }));

    const notice = await screen.findByRole('status');
    await waitFor(() => {
      expect(text(notice)).toContain('15');
    });
    expect(text(notice)).toContain('AAPL');
    expect(text(notice)).toBe(
      inv.notices.merged.replace('{ticker}', 'AAPL').replace('{quantity}', '15'),
    );
    expect(screen.getByText(inv.holding.quantity.replace('{quantity}', '15'))).toBeDefined();
    expect(screen.queryByLabelText(inv.forms.addHolding.ticker)).toBeNull();
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
      ticker: 'AAPL',
      quantity: '500000000',
    });
  });

  it('closes the add form and reloads after a plain add', async () => {
    const added: HoldingResponse = { ...SECOND_HOLDING };
    stubApi({
      'GET /auth/session': session(),
      [LIST]: [list(portfolio()), list(portfolio({}, [HOLDING, added]))],
      [`POST /investments/portfolios/${PORTFOLIO_ID}/holdings`]: {
        status: 201,
        body: { holding: added, merged: false },
      },
    });
    renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: addFor('Balanz') }));
    await user.type(screen.getByLabelText(inv.forms.addHolding.ticker), 'MSFT');
    await user.type(screen.getByLabelText(inv.forms.addHolding.instrumentName), 'Microsoft');
    await user.type(screen.getByLabelText(inv.forms.addHolding.quantity), '5');
    await user.click(screen.getByRole('button', { name: inv.forms.addHolding.submit }));

    expect(await screen.findByText('MSFT')).toBeDefined();
    expect(screen.queryByLabelText(inv.forms.addHolding.ticker)).toBeNull();
    expect(text(screen.getByRole('status'))).toBe('');
  });

  it('AC-24: an add rejected for its currency shows the mismatch next to the field', async () => {
    stubApi({
      'GET /auth/session': session(),
      [LIST]: list(portfolio()),
      [`POST /investments/portfolios/${PORTFOLIO_ID}/holdings`]: {
        status: 400,
        body: { code: 'VALIDATION_FAILED', fields: ['body.valuationCurrency'] },
      },
    });
    renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: addFor('Balanz') }));
    await user.type(screen.getByLabelText(inv.forms.addHolding.ticker), 'AAPL');
    await user.type(screen.getByLabelText(inv.forms.addHolding.instrumentName), 'Apple Inc.');
    await user.type(screen.getByLabelText(inv.forms.addHolding.quantity), '5');
    await user.click(screen.getByRole('button', { name: inv.forms.addHolding.submit }));

    expect(await screen.findByText(inv.errors.currencyMismatch)).toBeDefined();
    expect(screen.getByLabelText(inv.forms.addHolding.currency).getAttribute('aria-invalid')).toBe(
      'true',
    );
  });

  it('AC-05: editing a holding sends only the changed quantity and reloads', async () => {
    const edited: HoldingResponse = { ...HOLDING, quantity: '1500000000' };
    const { calls } = stubApi({
      'GET /auth/session': session(),
      [LIST]: [list(portfolio()), list(portfolio({}, [edited]))],
      [`PATCH /investments/holdings/${HOLDING.id}`]: { status: 200, body: edited },
    });
    renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    await openDetails('AAPL');
    await user.click(
      screen.getByRole('button', { name: inv.holding.editFor.replace('{ticker}', 'AAPL') }),
    );
    const quantity = screen.getByLabelText<HTMLInputElement>(inv.forms.editHolding.quantity);
    expect(quantity.value).toBe('10');
    await user.clear(quantity);
    await user.type(quantity, '15');
    await user.click(screen.getByRole('button', { name: inv.forms.editHolding.submit }));

    expect(await screen.findByText(inv.holding.quantity.replace('{quantity}', '15'))).toBeDefined();
    expect(screen.queryByLabelText(inv.forms.editHolding.quantity)).toBeNull();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ quantity: '1500000000' });
  });

  it('AC-07: setting a price sends minor units and reloads', async () => {
    const priced: HoldingResponse = { ...HOLDING, unitPrice: '18550', value: '185500' };
    const { calls } = stubApi({
      'GET /auth/session': session(),
      [LIST]: [list(portfolio()), list(portfolio({}, [priced]))],
      [`PUT /investments/holdings/${HOLDING.id}/price`]: { status: 200, body: priced },
    });
    renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    await openDetails('AAPL');
    await user.click(
      screen.getByRole('button', { name: inv.holding.setPriceFor.replace('{ticker}', 'AAPL') }),
    );
    await user.type(screen.getByLabelText(inv.forms.price.unitPrice), '185,50');
    await user.click(screen.getByRole('button', { name: inv.forms.price.submit }));

    await waitFor(() => {
      expect(totals()).toContain('1.855,00 ARS');
    });
    expect(screen.queryByLabelText(inv.forms.price.unitPrice)).toBeNull();
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ unitPrice: '18550' });
  });

  it('a failed load shows the error and a retry that reloads', async () => {
    const { calls } = stubApi({
      'GET /auth/session': session(),
      [LIST]: ['network-error', list(portfolio())],
    });
    renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(inv.errors.network);
    expect(screen.queryByRole('heading', { name: inv.empty.title })).toBeNull();
    await user.click(screen.getByRole('button', { name: es.app.retry }));

    expect(await screen.findByRole('heading', { name: 'Balanz' })).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(paths(calls).filter((call) => call === LIST)).toHaveLength(2);
  });

  it('a failed reload keeps the previous list and offers a retry', async () => {
    stubApi({
      'GET /auth/session': session(),
      [LIST]: [list(portfolio({}, [HOLDING, SECOND_HOLDING])), 'network-error'],
      [`DELETE /investments/holdings/${SECOND_HOLDING.id}`]: { status: 204 },
    });
    renderApp(<InvestmentsContainer />);

    await openDetails('MSFT');
    await userEvent
      .setup()
      .click(
        screen.getByRole('button', { name: inv.holding.deleteFor.replace('{ticker}', 'MSFT') }),
      );

    expect((await screen.findByRole('alert')).textContent).toContain(inv.errors.network);
    expect(screen.getByText('MSFT')).toBeDefined();
    expect(screen.getByRole('button', { name: es.app.retry })).toBeDefined();
  });

  it('AC-15: a failed mutation shows its message above the portfolio and leaves the list', async () => {
    const { calls } = stubApi({
      'GET /auth/session': session(),
      [LIST]: list(portfolio({}, [HOLDING, SECOND_HOLDING])),
      [`DELETE /investments/holdings/${SECOND_HOLDING.id}`]: NOT_FOUND,
    });
    renderApp(<InvestmentsContainer />);

    await openDetails('MSFT');
    await userEvent
      .setup()
      .click(
        screen.getByRole('button', { name: inv.holding.deleteFor.replace('{ticker}', 'MSFT') }),
      );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(inv.errors.notFound);
    const heading = screen.getByRole('heading', { name: 'Balanz' });
    expect(alert.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('MSFT')).toBeDefined();
    expect(totals()).toContain('285.000,00 ARS');
    expect(paths(calls).filter((call) => call === LIST)).toHaveLength(1);
  });

  it('a 401 on the list sends the user to sign-in', async () => {
    stubApi({
      'GET /auth/session': session(),
      [LIST]: UNAUTHENTICATED,
      'POST /auth/refresh': UNAUTHENTICATED,
    });
    const { router } = renderApp(<InvestmentsContainer />);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a 401 on a mutation sends the user to sign-in', async () => {
    stubApi({
      'GET /auth/session': session(),
      [LIST]: list(portfolio()),
      [`DELETE /investments/portfolios/${PORTFOLIO_ID}`]: UNAUTHENTICATED,
      'POST /auth/refresh': UNAUTHENTICATED,
    });
    const { router } = renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: deleteFor('Balanz') }));
    await user.click(screen.getByRole('button', { name: inv.forms.confirmDelete.confirm }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failed create shows the form-level error and keeps the form open', async () => {
    stubApi({
      'GET /auth/session': session(),
      [LIST]: list(portfolio()),
      'POST /investments/portfolios': { status: 500, body: { code: 'INTERNAL' } },
    });
    renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: inv.forms.createPortfolio.title }));
    await user.type(screen.getByLabelText(inv.forms.createPortfolio.name), 'IOL');
    await user.click(screen.getByRole('button', { name: inv.forms.createPortfolio.submit }));

    expect(await screen.findByText(inv.errors.unexpected)).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>(inv.forms.createPortfolio.name).value).toBe(
      'IOL',
    );
  });

  it('a failed edit shows the form-level error and keeps the form open', async () => {
    stubApi({
      'GET /auth/session': session(),
      [LIST]: list(portfolio()),
      [`PATCH /investments/holdings/${HOLDING.id}`]: { status: 500, body: { code: 'INTERNAL' } },
    });
    renderApp(<InvestmentsContainer />);
    const user = userEvent.setup();

    await openDetails('AAPL');
    await user.click(
      screen.getByRole('button', { name: inv.holding.editFor.replace('{ticker}', 'AAPL') }),
    );
    const quantity = screen.getByLabelText<HTMLInputElement>(inv.forms.editHolding.quantity);
    await user.clear(quantity);
    await user.type(quantity, '15');
    await user.click(screen.getByRole('button', { name: inv.forms.editHolding.submit }));

    expect(await screen.findByText(inv.errors.unexpected)).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>(inv.forms.editHolding.quantity).value).toBe(
      '15',
    );
  });

  describe('overlapping changes', () => {
    const ADD = `POST /investments/portfolios/${PORTFOLIO_ID}/holdings`;
    const OTHER = portfolio({ id: OTHER_ID, name: 'IOL' }, []);

    it('a pending add that fails puts no errors in the form opened meanwhile', async () => {
      const { fetch } = stubApi({
        'GET /auth/session': session(),
        [LIST]: list(portfolio(), OTHER),
        [ADD]: {
          status: 400,
          body: { code: 'VALIDATION_FAILED', fields: ['body.valuationCurrency'] },
        },
      });
      const gate = gateRequests(fetch, (method) => method === 'POST');
      renderApp(<InvestmentsContainer />);
      const user = userEvent.setup();

      await user.click(await firstOpener());
      await fillAddForm(user);
      await user.click(submitAddButton());
      await waitFor(() => {
        expect(gate.held()).toBe(1);
      });
      await user.click(await screen.findByRole('button', { name: addFor('IOL') }));
      gate.release(0);

      await waitFor(() => {
        expect(submitAddButton().disabled).toBe(false);
      });
      expect(screen.getByLabelText(inv.forms.addHolding.ticker)).toBeDefined();
      expect(screen.queryByText(inv.errors.currencyMismatch)).toBeNull();
    });

    it('a pending add that succeeds does not close the form opened meanwhile', async () => {
      const added: HoldingResponse = { ...SECOND_HOLDING };
      const { calls, fetch } = stubApi({
        'GET /auth/session': session(),
        [LIST]: list(portfolio(), OTHER),
        [ADD]: { status: 201, body: { holding: added, merged: false } },
      });
      const gate = gateRequests(fetch, (method) => method === 'POST');
      renderApp(<InvestmentsContainer />);
      const user = userEvent.setup();

      await user.click(await firstOpener());
      await fillAddForm(user);
      await user.click(submitAddButton());
      await waitFor(() => {
        expect(gate.held()).toBe(1);
      });
      await user.click(screen.getByRole('button', { name: inv.forms.createPortfolio.title }));
      gate.release(0);

      await waitFor(() => {
        expect(paths(calls).filter((call) => call === LIST)).toHaveLength(2);
      });
      expect(screen.getByLabelText(inv.forms.createPortfolio.name)).toBeDefined();
    });

    it('pending stays on until every overlapping delete has settled', async () => {
      const { calls, fetch } = stubApi({
        'GET /auth/session': session(),
        [LIST]: list(portfolio({}, [HOLDING, SECOND_HOLDING])),
        [`DELETE /investments/holdings/${HOLDING.id}`]: { status: 204 },
        [`DELETE /investments/holdings/${SECOND_HOLDING.id}`]: { status: 204 },
      });
      const gate = gateRequests(fetch, (method) => method === 'DELETE');
      renderApp(<InvestmentsContainer />);
      const user = userEvent.setup();

      await openDetails('MSFT');
      await openDetails('AAPL');
      await user.click(
        screen.getByRole('button', { name: inv.holding.deleteFor.replace('{ticker}', 'MSFT') }),
      );
      await user.click(
        screen.getByRole('button', { name: inv.holding.deleteFor.replace('{ticker}', 'AAPL') }),
      );
      await user.click(screen.getByRole('button', { name: deleteFor('Balanz') }));
      const confirm = screen.getByRole<HTMLButtonElement>('button', {
        name: inv.forms.confirmDelete.confirm,
      });
      await waitFor(() => {
        expect(gate.held()).toBe(2);
      });
      expect(confirm.disabled).toBe(true);

      gate.release(0);
      await waitFor(() => {
        expect(paths(calls).filter((call) => call === LIST)).toHaveLength(2);
      });
      expect(confirm.disabled).toBe(true);

      gate.release(1);
      await waitFor(() => {
        expect(confirm.disabled).toBe(false);
      });
    });
  });

  it('shows no deleted notice when the reload after the delete fails, only the failure', async () => {
    stubApi({
      'GET /auth/session': session(),
      [LIST]: [list(portfolio({}, [HOLDING, SECOND_HOLDING])), 'network-error'],
      [`DELETE /investments/holdings/${SECOND_HOLDING.id}`]: { status: 204 },
    });
    renderApp(<InvestmentsContainer />);

    await openDetails('MSFT');
    await userEvent
      .setup()
      .click(
        screen.getByRole('button', { name: inv.holding.deleteFor.replace('{ticker}', 'MSFT') }),
      );

    expect((await screen.findByRole('alert')).textContent).toContain(inv.errors.network);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  describe('notice and focus', () => {
    it('announces the notice through its status region without moving focus to it', async () => {
      stubApi({
        'GET /auth/session': session(),
        [LIST]: [list(portfolio({}, [HOLDING, SECOND_HOLDING])), list(portfolio({}, [HOLDING]))],
        [`DELETE /investments/holdings/${SECOND_HOLDING.id}`]: { status: 204 },
      });
      renderApp(<InvestmentsContainer />);

      await openDetails('MSFT');
      await userEvent
        .setup()
        .click(
          screen.getByRole('button', { name: inv.holding.deleteFor.replace('{ticker}', 'MSFT') }),
        );

      const region = await screen.findByRole('status');
      await waitFor(() => {
        expect(region.textContent).toContain(inv.notices.deleted);
      });
      expect(document.activeElement).not.toBe(region);
      expect(region.getAttribute('tabindex')).toBeNull();
      expect(region.className).not.toContain('empty:hidden');
      expect(region.className).toContain('empty:sr-only');
    });

    it('cancelling a form puts focus back on the control that opened it', async () => {
      stubApi({ 'GET /auth/session': session(), [LIST]: list(portfolio()) });
      renderApp(<InvestmentsContainer />);
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: addFor('Balanz') }));
      await user.click(screen.getByRole('button', { name: inv.forms.cancel }));

      expect(document.activeElement).toBe(screen.getByRole('button', { name: addFor('Balanz') }));
    });

    it('closing a confirmation puts focus back on its opener', async () => {
      stubApi({ 'GET /auth/session': session(), [LIST]: list(portfolio()) });
      renderApp(<InvestmentsContainer />);
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: deleteFor('Balanz') }));
      await user.click(screen.getByRole('button', { name: inv.forms.cancel }));

      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: deleteFor('Balanz') }),
      );
    });

    it('a successful create puts focus back on the create button', async () => {
      const other = portfolio({ id: OTHER_ID, name: 'IOL' }, []);
      stubApi({
        'GET /auth/session': session(),
        [LIST]: [list(portfolio()), list(portfolio(), other)],
        'POST /investments/portfolios': { status: 201, body: other },
      });
      renderApp(<InvestmentsContainer />);
      const user = userEvent.setup();

      await user.click(
        await screen.findByRole('button', { name: inv.forms.createPortfolio.title }),
      );
      await user.type(screen.getByLabelText(inv.forms.createPortfolio.name), 'IOL');
      await user.click(screen.getByRole('button', { name: inv.forms.createPortfolio.submit }));

      await waitFor(() => {
        expect(document.activeElement).toBe(
          screen.getByRole('button', { name: inv.forms.createPortfolio.title }),
        );
      });
    });
  });

  describe('focus with several portfolios', () => {
    const IOL = portfolio({ id: OTHER_ID, name: 'IOL' }, []);
    const ADD_IOL = `POST /investments/portfolios/${OTHER_ID}/holdings`;

    function renderInPage() {
      return renderApp(
        <main>
          <h1>Inversiones</h1>
          <InvestmentsContainer />
        </main>,
      );
    }

    /** The control of one portfolio's card whose name starts with the given text. */
    function inCard(name: string, prefix: string): HTMLElement {
      const card = screen.getByRole('heading', { name }).closest('section');
      if (!card) throw new Error(`No card for ${name}`);
      return within(card).getByRole('button', { name: new RegExp(`^${prefix}`) });
    }

    it('names each opener after its portfolio', async () => {
      stubApi({ 'GET /auth/session': session(), [LIST]: list(portfolio(), IOL) });
      renderInPage();

      expect(await screen.findByRole('button', { name: addFor('Balanz') })).toBeDefined();
      expect(screen.getByRole('button', { name: addFor('IOL') })).toBeDefined();
      expect(screen.getByRole('button', { name: deleteFor('Balanz') })).toBeDefined();
      expect(screen.getByRole('button', { name: deleteFor('IOL') })).toBeDefined();
    });

    it('a successful add on portfolio 2 puts focus on the opener of portfolio 2', async () => {
      stubApi({
        'GET /auth/session': session(),
        [LIST]: [list(portfolio(), IOL), list(portfolio(), IOL)],
        [ADD_IOL]: { status: 201, body: { holding: SECOND_HOLDING, merged: false } },
      });
      renderInPage();
      const user = userEvent.setup();

      await screen.findByRole('heading', { name: 'IOL' });
      await user.click(inCard('IOL', 'Agregar posición'));
      await fillAddForm(user);
      await user.click(submitAddButton());

      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByRole('button', { name: addFor('IOL') }));
      });
      expect(document.activeElement).not.toBe(
        screen.getByRole('button', { name: addFor('Balanz') }),
      );
    });

    it('cancelling the add form of portfolio 2 puts focus on the opener of portfolio 2', async () => {
      stubApi({ 'GET /auth/session': session(), [LIST]: list(portfolio(), IOL) });
      renderInPage();
      const user = userEvent.setup();

      await screen.findByRole('heading', { name: 'IOL' });
      await user.click(inCard('IOL', 'Agregar posición'));
      await user.click(screen.getByRole('button', { name: inv.forms.cancel }));

      expect(document.activeElement).toBe(screen.getByRole('button', { name: addFor('IOL') }));
    });

    it('cancelling the delete confirmation of portfolio 2 focuses its own delete button', async () => {
      stubApi({ 'GET /auth/session': session(), [LIST]: list(portfolio(), IOL) });
      renderInPage();
      const user = userEvent.setup();

      await screen.findByRole('heading', { name: 'IOL' });
      await user.click(inCard('IOL', 'Eliminar cartera'));
      await user.click(screen.getByRole('button', { name: inv.forms.cancel }));

      expect(document.activeElement).toBe(screen.getByRole('button', { name: deleteFor('IOL') }));
    });

    // The deleted portfolio's controls are gone and its neighbours' controls are destructive or
    // unrelated, so focus goes to the page heading: a safe, non-destructive place to restart from.
    it('deleting portfolio 1 of 2 focuses the page heading, not a delete button', async () => {
      stubApi({
        'GET /auth/session': session(),
        [LIST]: [list(portfolio(), IOL), list(IOL)],
        [`DELETE /investments/portfolios/${PORTFOLIO_ID}`]: { status: 204 },
      });
      renderInPage();
      const user = userEvent.setup();

      await screen.findByRole('heading', { name: 'Balanz' });
      await user.click(inCard('Balanz', 'Eliminar cartera'));
      await user.click(screen.getByRole('button', { name: inv.forms.confirmDelete.confirm }));

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: 'Balanz' })).toBeNull();
      });
      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
      });
      expect(document.activeElement).not.toBe(
        screen.getByRole('button', { name: deleteFor('IOL') }),
      );
    });

    it('a slow reload after deleting portfolio 1 still ends with focus on the page heading', async () => {
      const { fetch } = stubApi({
        'GET /auth/session': session(),
        [LIST]: [list(portfolio(), IOL), list(IOL)],
        [`DELETE /investments/portfolios/${PORTFOLIO_ID}`]: { status: 204 },
      });
      let lists = 0;
      const gate = gateRequests(
        fetch,
        (method, path) => method === 'GET' && path === '/investments/portfolios' && ++lists === 2,
      );
      renderInPage();
      const user = userEvent.setup();

      await screen.findByRole('heading', { name: 'Balanz' });
      await user.click(inCard('Balanz', 'Eliminar cartera'));
      await user.click(screen.getByRole('button', { name: inv.forms.confirmDelete.confirm }));
      await waitFor(() => {
        expect(gate.held()).toBe(1);
      });
      gate.release(0);

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: 'Balanz' })).toBeNull();
      });
      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
      });
    });

    it('a later reload does not steal focus to the heading after the user clicked away', async () => {
      stubApi({
        'GET /auth/session': session(),
        [LIST]: [
          list(portfolio({}, [HOLDING, SECOND_HOLDING]), IOL),
          list(portfolio({}, [HOLDING]), IOL),
        ],
        [`DELETE /investments/holdings/${SECOND_HOLDING.id}`]: { status: 204 },
      });
      renderInPage();
      const user = userEvent.setup();

      await screen.findByRole('heading', { name: 'IOL' });
      // Opened without focusing the opener (as Safari does), so the form remembers no opener and
      // closing it sends focus to the heading.
      fireEvent.click(inCard('IOL', 'Agregar posición'));
      await user.click(screen.getByRole('button', { name: inv.forms.cancel }));
      const heading = screen.getByRole('heading', { level: 1 });
      expect(document.activeElement).toBe(heading);

      // The user clicks a non-focusable area, then a change reloads the list.
      await user.click(document.body);
      expect(document.activeElement).toBe(document.body);
      fireEvent.click(
        screen.getByRole('button', {
          name: inv.holding.showDetailsFor.replace('{ticker}', 'MSFT'),
        }),
      );
      fireEvent.click(
        screen.getByRole('button', { name: inv.holding.deleteFor.replace('{ticker}', 'MSFT') }),
      );

      await waitFor(() => {
        expect(screen.queryByText('MSFT')).toBeNull();
      });
      expect(document.activeElement).toBe(document.body);
    });

    it.each([
      ['edit', (ticker: string) => inv.holding.editFor.replace('{ticker}', ticker)],
      ['price', (ticker: string) => inv.holding.setPriceFor.replace('{ticker}', ticker)],
    ] as const)(
      'deleting a holding whose %s form is open closes the form and focuses the heading',
      async (kind, openerName) => {
        stubApi({
          'GET /auth/session': session(),
          [LIST]: [list(portfolio({}, [HOLDING, SECOND_HOLDING])), list(portfolio({}, [HOLDING]))],
          [`DELETE /investments/holdings/${SECOND_HOLDING.id}`]: { status: 204 },
        });
        renderInPage();
        const user = userEvent.setup();

        await user.click(
          await screen.findByRole('button', {
            name: inv.holding.showDetailsFor.replace('{ticker}', 'MSFT'),
          }),
        );
        await user.click(screen.getByRole('button', { name: openerName('MSFT') }));
        const formTitle = kind === 'edit' ? inv.forms.editHolding.title : inv.forms.price.title;
        expect(screen.getByRole('heading', { name: formTitle })).toBeDefined();

        await user.click(
          screen.getByRole('button', { name: inv.holding.deleteFor.replace('{ticker}', 'MSFT') }),
        );

        await waitFor(() => {
          expect(screen.queryByText('MSFT')).toBeNull();
        });
        expect(screen.queryByRole('heading', { name: formTitle })).toBeNull();
        await waitFor(() => {
          expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
        });
      },
    );
  });

  describe('time zone', () => {
    const PRICED_AT = '2026-09-01T02:30:00.000Z';
    const stale: HoldingResponse = { ...HOLDING, priceStale: true, pricedAt: PRICED_AT };

    it("formats dates in the user's time zone from the session", async () => {
      const zone = 'America/Argentina/Buenos_Aires';
      const inZone = formatDateTime(PRICED_AT, zone, 'es');
      const inUtc = formatDateTime(PRICED_AT, 'UTC', 'es');
      expect(inZone).not.toBe(inUtc);
      const { calls } = stubApi({
        'GET /auth/session': session(zone),
        [LIST]: list(portfolio({}, [stale])),
      });
      renderApp(<InvestmentsContainer />);

      expect(
        await screen.findByText(inv.holding.stalePrice.replace('{date}', inZone)),
      ).toBeDefined();
      expect(paths(calls).filter((call) => call === 'GET /auth/session')).toHaveLength(1);
    });

    it('falls back to the browser time zone when the session call fails', async () => {
      const browserZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
      stubApi({
        'GET /auth/session': { status: 500, body: { code: 'INTERNAL' } },
        [LIST]: list(portfolio({}, [stale])),
      });
      renderApp(<InvestmentsContainer />);

      expect(
        await screen.findByText(
          inv.holding.stalePrice.replace('{date}', formatDateTime(PRICED_AT, browserZone, 'es')),
        ),
      ).toBeDefined();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('titles each portfolio with an h2 and leaves the h1 to the page', async () => {
    stubApi({ 'GET /auth/session': session(), [LIST]: list(portfolio()) });
    renderApp(<InvestmentsContainer />);

    const card = await screen.findByRole('heading', { name: 'Balanz' });
    expect(card.tagName).toBe('H2');
    expect(within(document.body).queryAllByRole('heading', { level: 1 })).toHaveLength(0);
  });
});

describe('InvestmentsContainer manual price warning (DISC-001-07b)', () => {
  const WARNED: HoldingResponse = {
    ...HOLDING,
    marketUnitPrice: '2050000',
    marketPricedAt: '2026-09-30T23:30:00.000Z',
    marketPriceDiffers: true,
    marketPriceRecent: true,
  };
  const SWITCH = `POST /investments/holdings/${HOLDING.id}/automatic-price`;
  const switchName = inv.holding.useAutomaticPriceFor.replace('{ticker}', 'AAPL');
  const warning = inv.holding.manualPriceDiffersToday.replace('{price}', '20.500,00 ARS');

  it('AC-12: pressing the button switches the holding to automatic and hides the warning', async () => {
    const switched: HoldingResponse = {
      ...WARNED,
      unitPrice: '2050000',
      priceSource: 'automatic',
      marketPriceDiffers: false,
      value: '20500000',
      gain: null,
    };
    const { calls } = stubApi({
      'GET /auth/session': session(),
      [LIST]: [list(portfolio({}, [WARNED])), list(portfolio({}, [switched]))],
      [SWITCH]: { status: 200, body: switched },
    });
    renderApp(<InvestmentsContainer />);

    expect(await screen.findByText(warning)).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: switchName }));

    await waitFor(() => {
      expect(screen.queryByText(warning)).toBeNull();
    });
    expect(screen.queryByRole('button', { name: switchName })).toBeNull();
    await openDetails('AAPL');
    expect(screen.getByText(inv.priceSources.automatic)).toBeDefined();
    expect(paths(calls)).toEqual(['GET /auth/session', LIST, SWITCH, LIST]);
  });

  it.each([
    ['404', NOT_FOUND, inv.errors.notFound],
    ['400', { status: 400, body: { code: 'VALIDATION_FAILED' } }, inv.errors.unexpected],
  ])(
    'AC-13: a %s leaves the holding and shows the portfolio message',
    async (_name, answer, key) => {
      const { calls } = stubApi({
        'GET /auth/session': session(),
        [LIST]: list(portfolio({}, [WARNED])),
        [SWITCH]: answer,
      });
      renderApp(<InvestmentsContainer />);

      await userEvent.setup().click(await screen.findByRole('button', { name: switchName }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(key);
      expect(screen.getByText(warning)).toBeDefined();
      expect(screen.getByRole('button', { name: switchName })).toBeDefined();
      expect(paths(calls).filter((call) => call === LIST)).toHaveLength(1);
    },
  );

  const switched: HoldingResponse = {
    ...WARNED,
    unitPrice: '2050000',
    priceSource: 'automatic',
    marketPriceDiffers: false,
    value: '20500000',
    gain: null,
  };
  const notice = inv.notices.automaticPrice.replace('{ticker}', 'AAPL');
  const detailsToggle = inv.holding.showDetailsFor.replace('{ticker}', 'AAPL');

  it('announces the switch in the status region and moves focus to the holding details toggle', async () => {
    stubApi({
      'GET /auth/session': session(),
      [LIST]: [list(portfolio({}, [WARNED])), list(portfolio({}, [switched]))],
      [SWITCH]: { status: 200, body: switched },
    });
    renderApp(<InvestmentsContainer />);

    const button = await screen.findByRole('button', { name: switchName });
    button.focus();
    await userEvent.setup().click(button);

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(notice);
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: detailsToggle }));
    });
  });

  it('shows the portfolio failure and no notice when the switch fails', async () => {
    stubApi({
      'GET /auth/session': session(),
      [LIST]: list(portfolio({}, [WARNED])),
      [SWITCH]: NOT_FOUND,
    });
    renderApp(<InvestmentsContainer />);

    await userEvent.setup().click(await screen.findByRole('button', { name: switchName }));

    await screen.findByRole('alert');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('disables the button while the switch is in flight and sends one POST on a double click', async () => {
    const { calls, fetch } = stubApi({
      'GET /auth/session': session(),
      [LIST]: [list(portfolio({}, [WARNED])), list(portfolio({}, [switched]))],
      [SWITCH]: { status: 200, body: switched },
    });
    const gate = gateRequests(fetch, (method) => method === 'POST');
    renderApp(<InvestmentsContainer />);

    const button = await screen.findByRole<HTMLButtonElement>('button', { name: switchName });
    const user = userEvent.setup();
    await user.dblClick(button);

    await waitFor(() => {
      expect(gate.held()).toBe(1);
    });
    expect(button.disabled).toBe(true);
    expect(gate.held()).toBe(1);

    gate.release(0);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: switchName })).toBeNull();
    });
    expect(paths(calls).filter((call) => call === SWITCH)).toHaveLength(1);
  });
});
