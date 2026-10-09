// @vitest-environment happy-dom
import type { CreditCardResponse } from '@pesly/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatementImportContainer } from '../src/features/credit-cards/containers/statement-import-container';
import { extractPdfLines } from '../src/features/credit-cards/statement-import/extract-pdf-lines';
import {
  macroVisaLines,
  monospacedLines,
} from '../src/features/credit-cards/statement-import/macro-visa-fixture';
import {
  parserForFile,
  statementParser,
} from '../src/features/credit-cards/statement-import/statement-parser';
import { StatementParseError } from '../src/features/credit-cards/statement-import/statement-types';
import { category, page, uuid } from './support/category-fixtures';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

// pdf.js is covered by its own Node test; here the extraction is replaced by fixture lines.
vi.mock('../src/features/credit-cards/statement-import/extract-pdf-lines', () => ({
  extractPdfLines: vi.fn(),
}));

const extract = vi.mocked(extractPdfLines);
const t = CATALOGS.es.creditCards.import;

const ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const card: CreditCardResponse = {
  id: ID,
  name: 'Visa',
  closingDay: 24,
  dueDay: 5,
  arsAccountId: '11111111-1111-4111-8111-111111111111',
  usdAccountId: '22222222-2222-4222-8222-222222222222',
  createdAt: '2026-10-01T12:00:00.000Z',
};

const PDF = new File(['%PDF-1.4'], 'resumen.pdf', { type: 'application/pdf' });

async function open() {
  const stub = stubApi({
    [`GET /credit-cards/${ID}`]: { status: 200, body: card },
    'GET /categories?kind=expense&archived=false&limit=100': page([
      category({ id: uuid(11), kind: 'expense', name: 'Comida' }),
    ]),
  });
  renderApp(<StatementImportContainer cardId={ID} />, { locale: 'es' });
  const input = await screen.findByLabelText<HTMLInputElement>(t.file.label);
  return { ...stub, input };
}

beforeEach(() => {
  extract.mockReset();
});

describe('statement parser selection', () => {
  it('accepts Excel and PDF by extension and MIME type, for mobile pickers', () => {
    const accept = statementParser.accept.split(',');
    expect(accept).toEqual(expect.arrayContaining(['.xlsx', '.pdf', 'application/pdf']));
    expect(accept.some((entry) => entry.includes('spreadsheetml.sheet'))).toBe(true);
  });

  it('picks the parser by MIME type or extension, whichever the browser reports', () => {
    expect(parserForFile(new File([''], 'a.pdf', { type: 'application/pdf' }))?.accept).toContain(
      '.pdf',
    );
    expect(
      parserForFile(new File([''], 'download', { type: 'application/pdf' }))?.accept,
    ).toContain('.pdf');
    expect(parserForFile(new File([''], 'RESUMEN.PDF'))?.accept).toContain('.pdf');
    expect(parserForFile(new File([''], 'a.xlsx'))?.accept).toContain('.xlsx');
    expect(parserForFile(new File([''], 'a.txt', { type: 'text/plain' }))).toBeNull();
  });

  it('refuses a file of another type as unreadable', async () => {
    await expect(statementParser.parse(new File([''], 'a.txt'))).rejects.toMatchObject({
      code: 'unreadable',
    });
  });
});

describe('StatementImportContainer with a PDF statement', () => {
  it('offers both file types in the file input', async () => {
    const { input } = await open();
    expect(input.accept).toContain('.pdf');
    expect(input.accept).toContain('.xlsx');
  });

  it('previews a Macro PDF with its reconciled total and sends nothing yet', async () => {
    extract.mockResolvedValue(macroVisaLines());
    const { input, calls } = await open();
    await userEvent.upload(input, PDF);

    const table = await screen.findByRole('table', { name: t.preview.caption });
    expect(within(table).getByText('BIDCOM')).toBeTruthy();
    expect(within(table).getByText('5 de 18')).toBeTruthy();
    expect(within(table).getByText('IMPUESTO DE SELLOS')).toBeTruthy();
    expect(within(table).getAllByText(t.status.ignored)).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('shows the unrecognized-format error for another layout and sends nothing', async () => {
    extract.mockResolvedValue(monospacedLines(['RESUMEN DE OTRO BANCO']));
    const { input, calls } = await open();
    await userEvent.upload(input, PDF);
    expect(await screen.findByText(t.errors.unrecognizedFormat)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('shows the no-text-layer error for a scanned PDF', async () => {
    extract.mockResolvedValue([]);
    const { input } = await open();
    await userEvent.upload(input, PDF);
    expect(await screen.findByText(t.errors.noTextLayer)).toBeTruthy();
  });

  it('shows the unreadable error when pdf.js cannot open the file', async () => {
    extract.mockRejectedValue(new StatementParseError('unreadable'));
    const { input } = await open();
    await userEvent.upload(input, PDF);
    expect(await screen.findByText(t.errors.unreadable)).toBeTruthy();
  });

  it('rejects a PDF over the size limit before reading it', async () => {
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    const { input } = await open();
    await userEvent.upload(input, big);
    expect(await screen.findByText(t.errors.tooLarge)).toBeTruthy();
    expect(extract).not.toHaveBeenCalled();
  });
});
