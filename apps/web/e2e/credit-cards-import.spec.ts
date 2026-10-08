import { DEFAULT_CATEGORIES, defaultCategoryName } from '@pesly/shared';
import { expect, test, type Page } from '@playwright/test';
import writeExcelFile from 'write-excel-file/node';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';
import { emailLink } from './support/mailpit';

const PASSWORD = 'correct horse battery staple';
const es = catalogs.es;
const t = es.creditCards;

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

/** A fresh address per test: the e2e database and the Mailpit inbox persist across runs. */
function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.argent.test`;
}

async function signedInUser(page: Page, label: string): Promise<void> {
  const email = uniqueEmail(label);
  await page.goto('/es/register');
  await page.getByLabel(es.auth.fields.displayName).fill('Ana Pérez');
  await page.getByLabel(es.auth.fields.email).fill(email);
  await page.getByLabel(es.auth.fields.password).fill(PASSWORD);
  await page.getByRole('button', { name: es.auth.register.submit }).click();
  await expect(page.getByRole('heading', { name: es.auth.checkYourEmail.title })).toBeVisible();
  await page.goto((await emailLink(email, 'verify-email')).toString());
  await expect(
    page.getByRole('heading', { name: es.auth.verifyEmail.verifiedTitle }),
  ).toBeVisible();
  await page.goto('/es/sign-in');
  await page.getByLabel(es.auth.fields.email).fill(email);
  await page.getByLabel(es.auth.fields.password).fill(PASSWORD);
  await page.getByRole('button', { name: es.auth.signIn.submit }).click();
  await expect(page).toHaveURL(/\/es$/);
}

const EXPENSE_CATEGORY = (() => {
  const entry = DEFAULT_CATEGORIES.find(
    (item) => item.kind === 'expense' && item.parentKey === null,
  );
  if (entry === undefined) throw new Error('No default expense category');
  return defaultCategoryName(entry.key, 'es');
})();

const pad = (n: number) => String(n).padStart(2, '0');
const dmy = (date: Date) =>
  `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${String(date.getUTCFullYear())}`;

/** A synthetic statement that closed last month, in the layout of the bank export. */
async function statementFile(): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const now = new Date();
  const closing = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 24));
  const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 5));
  const early = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 3));
  const later = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 12));
  const rows: (string | null)[][] = [
    ['Movimientos del resumen'],
    ['Tarjeta Visa Crédito terminada en 1234'],
    ['Fecha de cierre', 'Fecha de vencimiento'],
    [dmy(closing), dmy(due)],
    ['Total a pagar'],
    ['$1.011,00', 'U$S5,00'],
    ['Pago de tarjeta y devoluciones'],
    ['Fecha', 'Descripción', 'Cuotas', 'Comprobante', 'Monto en pesos', 'Monto en dólares'],
    [dmy(early), 'Su pago en pesos', '', '-', '$-100,00', null],
    ['Tarjeta de Persona Ejemplo - 9999'],
    ['Fecha', 'Descripción', 'Cuotas', 'Comprobante', 'Monto en pesos', 'Monto en dólares'],
    [dmy(early), 'Tienda de ejemplo', '2 de 6', '000111*', '$600,00', null],
    [dmy(later), 'Kiosco de ejemplo', '', '000222*', '$400,00', null],
    [dmy(later), 'Servicio de ejemplo', '', '000333K', null, 'U$S5,00'],
    ['Total de Visa Crédito terminada en 9999', null, null, null, '$1.000,00', 'U$S5,00'],
    ['Otros conceptos'],
    ['Descripción', 'Monto en pesos'],
    ['Impuesto de ejemplo', '$11,00'],
  ];
  const buffer = await writeExcelFile(
    rows.map((row) => row.map((value) => (value === null ? null : { value }))),
  ).toBuffer();
  return {
    name: 'resumen-ejemplo.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  };
}

test.beforeEach(async () => {
  await resetAttemptLimits();
});

test('imports a statement file once and skips every line when it is imported again', async ({
  page,
}) => {
  await signedInUser(page, 'card-import');

  await page.goto('/es/cards/new');
  await page.getByLabel(t.form.name).fill('Visa');
  await page.getByLabel(t.form.closingDay).fill('24');
  await page.getByLabel(t.form.dueDay).fill('5');
  await page.getByRole('button', { name: t.form.submit }).click();
  await expect(page).toHaveURL(/\/es\/cards$/);
  const href = await page
    .getByRole('listitem', { name: 'Visa', exact: true })
    .getByRole('link')
    .getAttribute('href');
  const cardId = /\/cards\/([^/?#]+)/.exec(href ?? '')?.[1];
  if (cardId === undefined) throw new Error('No card id in the link');

  const file = await statementFile();
  const importFile = async () => {
    await page.goto(`/es/cards/${cardId}/import`);
    await expect(page.getByText(t.import.file.hint)).toBeVisible();
    await page.getByLabel(t.import.file.label).setInputFiles(file);
    await expect(page.getByRole('table', { name: t.import.preview.caption })).toBeVisible();
    await page.getByLabel(t.import.category.label).selectOption({ label: EXPENSE_CATEGORY });
    await page.getByRole('button', { name: /^Importar \d+ líneas$/ }).click();
    await expect(page.getByRole('heading', { name: t.import.result.title })).toBeVisible();
  };

  await importFile();
  await expect(page.getByText(/Se agregaron 4 líneas/)).toBeVisible();

  await importFile();
  await expect(page.getByText(/4 se omitieron porque ya estaban importadas/)).toBeVisible();

  // Sad path: a file that is not a spreadsheet is refused before any request.
  await page.goto(`/es/cards/${cardId}/import`);
  await page.getByLabel(t.import.file.label).setInputFiles({
    name: 'notas.xlsx',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a spreadsheet'),
  });
  await expect(page.getByText(t.import.errors.unreadable)).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});
