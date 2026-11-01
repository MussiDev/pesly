// @vitest-environment happy-dom
import type { CreditCardResponse } from '@pesly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StatementImportContainer } from '../src/features/credit-cards/containers/statement-import-container';
import {
  buildStatementImportRequest,
  reconcile,
  selectedLines,
  tooManyLines,
} from '../src/features/credit-cards/statement-import/import-request';
import { parseStatementRows } from '../src/features/credit-cards/statement-import/parse-statement-rows';
import { syntheticStatementRows } from '../src/features/credit-cards/statement-import/statement-fixture';
import {
  StatementParseError,
  type ParsedStatement,
  type StatementParser,
} from '../src/features/credit-cards/statement-import/statement-types';
import { category, page, uuid } from './support/category-fixtures';
import { CATALOGS, renderApp, stubApi, type ApiCall } from './support/render-app';

const { es, en } = CATALOGS;

const ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const CARD_PATH = `/credit-cards/${ID}`;
const POST = `POST ${CARD_PATH}/statement-imports`;
const COMIDA_ID = uuid(11);

const card: CreditCardResponse = {
  id: ID,
  name: 'Visa',
  closingDay: 24,
  dueDay: 5,
  arsAccountId: '11111111-1111-4111-8111-111111111111',
  usdAccountId: '22222222-2222-4222-8222-222222222222',
  debitArsAccountId: null,
  debitUsdAccountId: null,
  reminderDays: 3,
  createdAt: '2026-10-01T12:00:00.000Z',
};

const RESULT = { created: 8, skipped: 1, createdExpenses: 6, createdInstallmentPurchases: 2 };

function routes(overrides: Record<string, Parameters<typeof stubApi>[0][string]> = {}) {
  return {
    [`GET ${CARD_PATH}`]: { status: 200, body: card },
    'GET /categories?kind=expense&archived=false&limit=100': page([
      category({ id: COMIDA_ID, kind: 'expense', name: 'Comida' }),
      category({ id: uuid(13), kind: 'expense', name: 'Vieja', archived: true }),
    ]),
    [POST]: { status: 201, body: RESULT },
    ...overrides,
  };
}

const statement = (): ParsedStatement => parseStatementRows(syntheticStatementRows());

function parserOf(result: ParsedStatement | Error): StatementParser {
  return {
    accept: '.xlsx',
    parse: vi.fn(() =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
    ),
  };
}

const posts = (calls: ApiCall[]) => calls.filter((call) => call.method === 'POST');
const FILE = new File(['x'], 'statement.xlsx');

async function open(parser: StatementParser, answers = routes(), locale: 'es' | 'en' = 'es') {
  const stub = stubApi(answers);
  const view = renderApp(<StatementImportContainer cardId={ID} parser={parser} />, { locale });
  const label = CATALOGS[locale].creditCards.import.file.label;
  const input = await screen.findByLabelText<HTMLInputElement>(label);
  return { ...stub, ...view, input };
}

const t = es.creditCards.import;

describe('StatementImportContainer', () => {
  it('shows the accepted file types before any file is chosen', async () => {
    await open(parserOf(statement()));
    expect(screen.getByText(t.file.hint)).toBeTruthy();
    expect(screen.queryByText(t.preview.title)).toBeNull();
  });

  it('previews every line with its status and sends nothing yet', async () => {
    const { input, calls } = await open(parserOf(statement()));
    await userEvent.upload(input, FILE);

    const table = await screen.findByRole('table', { name: t.preview.caption });
    const rows = within(table).getAllByRole('row');
    // header + 1 payment + 7 purchases + 2 fees
    expect(rows).toHaveLength(11);
    expect(within(table).getByText('Tienda uno')).toBeTruthy();
    expect(within(table).getByText('5 de 6')).toBeTruthy();
    expect(within(table).getAllByText(t.status.ignored)).toHaveLength(1);
    expect(posts(calls)).toHaveLength(0);
  });

  it('shows no warning when the selected lines add up to the statement totals', async () => {
    const { input } = await open(parserOf(statement()));
    await userEvent.upload(input, FILE);
    await screen.findByRole('table');
    expect(screen.queryByText(t.reconcile.differs)).toBeNull();
  });

  it('warns, without blocking, when the fees are left out and the sums differ', async () => {
    const { input } = await open(parserOf(statement()));
    const user = userEvent.setup();
    await user.upload(input, FILE);
    await user.click(await screen.findByLabelText(t.includeFees));

    expect(screen.getByText(t.reconcile.differs)).toBeTruthy();
    expect(screen.getAllByText(t.status.skippedFee)).toHaveLength(2);
    const button = screen.getByRole('button', { name: /Importar 7 líneas/ });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('asks for a category before importing', async () => {
    const { input, calls } = await open(parserOf(statement()));
    const user = userEvent.setup();
    await user.upload(input, FILE);
    await user.click(await screen.findByRole('button', { name: /Importar 9 líneas/ }));

    expect(screen.getByText(t.category.required)).toBeTruthy();
    expect(posts(calls)).toHaveLength(0);
  });

  it('imports the selected lines with one category and shows the counts and a link to the card', async () => {
    const { input, calls } = await open(parserOf(statement()));
    const user = userEvent.setup();
    await user.upload(input, FILE);
    await user.selectOptions(await screen.findByLabelText(t.category.label), COMIDA_ID);
    await user.click(screen.getByRole('button', { name: /Importar 9 líneas/ }));

    await screen.findByText(t.result.title);
    const [post] = posts(calls);
    expect(post?.path).toBe(`${CARD_PATH}/statement-imports`);
    const body = post?.body as { closingDate: string; categoryId: string; lines: unknown[] };
    expect(body.closingDate).toBe('2026-09-24');
    expect(body).toHaveProperty('dueDate', '2026-10-05');
    expect(body.categoryId).toBe(COMIDA_ID);
    expect(body.lines).toHaveLength(9);
    expect(JSON.stringify(body)).not.toContain('Su pago');
    expect(screen.getByRole('status', { name: '' }).textContent).toBeTruthy();
    const link = screen.getByRole('link', { name: t.result.viewCard });
    expect(link.getAttribute('href')).toContain(`/cards/${ID}`);
  });

  it.each([
    ['tooLarge', t.errors.tooLarge],
    ['unreadable', t.errors.unreadable],
    ['unrecognized', t.errors.unrecognized],
    ['unrecognizedFormat', t.errors.unrecognizedFormat],
    ['noTextLayer', t.errors.noTextLayer],
    ['noLines', t.errors.noLines],
  ] as const)('shows a localized error for a %s file and sends nothing', async (code, message) => {
    const { input, calls } = await open(parserOf(new StatementParseError(code)));
    await userEvent.upload(input, FILE);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(posts(calls)).toHaveLength(0);
  });

  it('treats an unexpected parser failure as an unreadable file', async () => {
    const { input } = await open(parserOf(new Error('boom')));
    await userEvent.upload(input, FILE);
    expect(await screen.findByText(t.errors.unreadable)).toBeTruthy();
  });

  it('keeps the preview and says a connection is needed when the request cannot be sent', async () => {
    const { input } = await open(parserOf(statement()), routes({ [POST]: 'network-error' }));
    const user = userEvent.setup();
    await user.upload(input, FILE);
    await user.selectOptions(await screen.findByLabelText(t.category.label), COMIDA_ID);
    await user.click(screen.getByRole('button', { name: /Importar 9 líneas/ }));

    expect(await screen.findByText(t.connectionNeeded)).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('shows the write limit wait on a rate-limited answer', async () => {
    const { input } = await open(
      parserOf(statement()),
      routes({
        [POST]: {
          status: 429,
          headers: { 'Retry-After': '30' },
          body: { code: 'RATE_LIMITED' },
        },
      }),
    );
    const user = userEvent.setup();
    await user.upload(input, FILE);
    await user.selectOptions(await screen.findByLabelText(t.category.label), COMIDA_ID);
    await user.click(screen.getByRole('button', { name: /Importar 9 líneas/ }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('blocks the import above 300 selected lines', async () => {
    const base = statement();
    const purchase = base.lines.find((line) => line.kind === 'purchase');
    if (!purchase) throw new Error('fixture has purchases');
    const big = { ...base, lines: Array.from({ length: 301 }, () => ({ ...purchase })) };
    const { input } = await open(parserOf(big));
    await userEvent.upload(input, FILE);
    await screen.findByText(t.tooMany);
    const button = screen.getByRole('button', { name: /Importar 301 líneas/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('answers a missing card with the not found state', async () => {
    stubApi(routes({ [`GET ${CARD_PATH}`]: { status: 404, body: { code: 'NOT_FOUND' } } }));
    renderApp(<StatementImportContainer cardId={ID} parser={parserOf(statement())} />, {
      locale: 'es',
    });
    expect(await screen.findByText(t.notFound)).toBeTruthy();
  });

  it('renders in English', async () => {
    const { input } = await open(parserOf(statement()), routes(), 'en');
    await userEvent.upload(input, FILE);
    expect(await screen.findByText(en.creditCards.import.preview.title)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Import 9 lines/ })).toBeTruthy();
  });
});

describe('import request helpers', () => {
  const parsed = statement();

  it('selects purchases always, fees on request and never payments', () => {
    expect(selectedLines(parsed, true)).toHaveLength(9);
    expect(selectedLines(parsed, false)).toHaveLength(7);
    expect(selectedLines(parsed, true).some((line) => line.kind === 'payment')).toBe(false);
  });

  it('builds the request without payments and with exact amount strings', () => {
    const request = buildStatementImportRequest(parsed, {
      includeFees: true,
      categoryId: COMIDA_ID,
    });
    expect(request.lines).toHaveLength(9);
    expect(request.lines.every((line) => /^[1-9]\d*$/.test(line.amount))).toBe(true);
    expect(request.lines.filter((line) => line.kind === 'fee')).toHaveLength(2);
  });

  it('reconciles per currency against the file totals', () => {
    expect(reconcile(parsed, true).every((check) => check.matches)).toBe(true);
    const without = reconcile(parsed, false).find((check) => check.currency === 'ARS');
    expect(without?.matches).toBe(false);
    expect(without?.total).toBe(123697376n);
  });

  it('reports no total when the file has none for a currency', () => {
    const noTotals = { ...parsed, totals: { ARS: null, USD: null } };
    const checks = reconcile(noTotals, true);
    expect(checks.map((check) => check.total)).toEqual([null, null]);
    expect(checks.some((check) => check.matches)).toBe(false);
  });

  it('flags more than 300 selected lines', () => {
    const line = parsed.lines[1];
    if (!line) throw new Error('fixture line');
    expect(
      tooManyLines({ ...parsed, lines: Array.from({ length: 301 }, () => ({ ...line })) }, false),
    ).toBe(true);
    expect(tooManyLines(parsed, true)).toBe(false);
  });
});

describe('StatementImportContainer category suggestions (FEAT-016)', () => {
  const AUTO_ID = uuid(21);
  const NAFTA_ID = uuid(22);
  const RULES = 'GET /credit-cards/category-rules';
  const line = (description: string, amount: string) => ({
    date: '2026-09-10',
    description,
    voucher: null,
    installmentNumber: null,
    installmentCount: null,
    currency: 'ARS' as const,
    amount,
    kind: 'purchase' as const,
  });
  const parsed = (): ParsedStatement => ({
    closingDate: '2026-09-24',
    dueDate: '2026-10-05',
    cardEnding: null,
    totals: { ARS: '600', USD: null },
    lines: [
      line('CHEVROLET SA PLAN 12/84', '100'),
      line('YPF 1234', '200'),
      line('KIOSCO JUAN 77', '300'),
    ],
  });
  const answers = (rules: Parameters<typeof stubApi>[0][string]) =>
    routes({
      'GET /categories?kind=expense&archived=false&limit=100': page([
        category({ id: COMIDA_ID, kind: 'expense', name: 'Comida' }),
        category({ id: AUTO_ID, kind: 'expense', name: 'Auto' }),
        category({ id: NAFTA_ID, kind: 'expense', name: null, key: 'transport.fuel' }),
      ]),
      [RULES]: rules,
    });
  const learned = {
    status: 200,
    body: { rules: [{ merchantKey: 'kiosco juan', categoryId: COMIDA_ID }] },
  };
  const selectOf = (description: string) =>
    screen.getByLabelText<HTMLSelectElement>(
      t.category.lineLabel.replace('{description}', description),
    );

  it('pre-fills each line from the merchant and the learned rules, and says where it came from', async () => {
    const { input } = await open(parserOf(parsed()), answers(learned));
    await userEvent.upload(input, FILE);
    await screen.findByRole('table');

    expect(selectOf('CHEVROLET SA PLAN 12/84').value).toBe(AUTO_ID);
    expect(selectOf('YPF 1234').value).toBe(NAFTA_ID);
    expect(selectOf('KIOSCO JUAN 77').value).toBe(COMIDA_ID);
    expect(screen.getAllByText(t.category.keyword)).toHaveLength(2);
    expect(screen.getAllByText(t.category.learned)).toHaveLength(1);
    expect(screen.getByText(t.category.hint)).toBeTruthy();
  });

  it('imports with each line category and no general one when every line has a category', async () => {
    const { input, calls } = await open(parserOf(parsed()), answers(learned));
    const user = userEvent.setup();
    await user.upload(input, FILE);
    await user.click(await screen.findByRole('button', { name: /Importar 3 líneas/ }));

    await screen.findByText(t.result.title);
    const body = posts(calls)[0]?.body as { categoryId?: string; lines: { categoryId?: string }[] };
    expect(body.categoryId).toBeUndefined();
    expect(body.lines.map((item) => item.categoryId)).toEqual([AUTO_ID, NAFTA_ID, COMIDA_ID]);
  });

  it('asks for the general category once a line is set back to it, then sends it for that line', async () => {
    const { input, calls } = await open(parserOf(parsed()), answers(learned));
    const user = userEvent.setup();
    await user.upload(input, FILE);
    await screen.findByRole('table');
    await user.selectOptions(selectOf('YPF 1234'), '');
    expect(screen.getAllByText(t.category.keyword)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /Importar 3 líneas/ }));

    expect(screen.getByText(t.category.required)).toBeTruthy();
    expect(posts(calls)).toHaveLength(0);

    await user.selectOptions(screen.getByLabelText(t.category.label), COMIDA_ID);
    await user.selectOptions(selectOf('CHEVROLET SA PLAN 12/84'), NAFTA_ID);
    await user.click(screen.getByRole('button', { name: /Importar 3 líneas/ }));

    await screen.findByText(t.result.title);
    const body = posts(calls)[0]?.body as { categoryId?: string; lines: { categoryId?: string }[] };
    expect(body.categoryId).toBe(COMIDA_ID);
    expect(body.lines.map((item) => item.categoryId)).toEqual([NAFTA_ID, undefined, COMIDA_ID]);
  });

  it('still suggests from the merchant when the learned rules cannot be read', async () => {
    const { input } = await open(parserOf(parsed()), answers({ status: 500, body: {} }));
    await userEvent.upload(input, FILE);
    await screen.findByRole('table');

    expect(selectOf('CHEVROLET SA PLAN 12/84').value).toBe(AUTO_ID);
    expect(selectOf('KIOSCO JUAN 77').value).toBe('');
  });

  it('labels the line categories in English', async () => {
    const { input } = await open(parserOf(parsed()), answers(learned), 'en');
    await userEvent.upload(input, FILE);
    await screen.findByRole('table');

    expect(screen.getAllByText(en.creditCards.import.category.learned)).toHaveLength(1);
    expect(screen.getByText(en.creditCards.import.category.column)).toBeTruthy();
  });
});

describe('buildStatementImportRequest with line categories', () => {
  it('omits the general category when it is empty and adds each line category', () => {
    const request = buildStatementImportRequest(statement(), {
      includeFees: false,
      categoryId: '',
      lineCategories: new Map([[1, COMIDA_ID]]),
    });
    expect(request).not.toHaveProperty('categoryId');
    expect(request.lines.filter((item) => item.categoryId === COMIDA_ID)).toHaveLength(
      statement().lines[1]?.kind === 'purchase' ? 1 : 0,
    );
  });
});
