import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { catalogs } from './support/catalogs';
import { registerAndVerify, signIn, uniqueEmail } from './support/accounts';
import { resetAttemptLimits } from './support/database';

const PORTFOLIO = 'Balanz';
const t = catalogs.es.investments;
const labels = t.import;

// The anonymized Balanz export (IBIT 46, SPY 2); it carries no personal data inside.
const SAMPLE = readFileSync(
  fileURLToPath(new URL('../test/fixtures/balanz-holdings.xlsx', import.meta.url)),
);

const consoleErrors: string[] = [];

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

test.beforeEach(async ({ page }) => {
  await resetAttemptLimits();
  consoleErrors.length = 0;
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });
});

test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
});

function card(page: Page, name: string): Locator {
  return page.locator('section', {
    has: page.getByRole('heading', { name, exact: true, level: 2 }),
  });
}

function holdingRows(page: Page): Locator {
  return card(page, PORTFOLIO).getByRole('list', { name: t.portfolio.holdingsLabel }).locator('li');
}

async function openImport(page: Page): Promise<void> {
  await card(page, PORTFOLIO)
    .getByRole('button', { name: labels.actionFor.replace('{name}', PORTFOLIO), exact: true })
    .click();
}

const workbook = {
  name: 'MisInstrumentos.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer: SAMPLE,
};

test('a Balanz file is previewed, cancelled, then imported with the chosen currencies (AC-02, AC-03, AC-04, AC-05, AC-07, AC-09)', async ({
  page,
}) => {
  // The first request of a cold `next dev` compiles the page, above the 30 s default.
  test.setTimeout(180_000);
  const email = uniqueEmail('balanz');
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);

  await test.step('a portfolio with one holding added by hand', async () => {
    await page.goto('/es/investments');
    await page.getByLabel(t.forms.createPortfolio.name, { exact: true }).fill(PORTFOLIO);
    await page.getByRole('button', { name: t.forms.createPortfolio.submit }).click();
    await expect(card(page, PORTFOLIO)).toBeVisible();

    const form = t.forms.addHolding;
    await card(page, PORTFOLIO)
      .getByRole('button', {
        name: t.portfolio.addHoldingFor.replace('{name}', PORTFOLIO),
        exact: true,
      })
      .click();
    await page.getByLabel(form.ticker, { exact: true }).fill('AAPL');
    await page.getByLabel(form.instrumentName, { exact: true }).fill('Apple Inc.');
    await page.getByLabel(form.quantity, { exact: true }).fill('5');
    await page.getByRole('button', { name: form.submit }).click();
    await expect(holdingRows(page)).toHaveCount(1);
  });

  await test.step('AC-02 the preview lists what will be added and removed, AC-04 cancel changes nothing', async () => {
    await openImport(page);
    await page.getByLabel(labels.fileLabel).setInputFiles(workbook);

    await expect(page.getByText('2 para agregar, 0 para actualizar, 1 para quitar.')).toBeVisible();
    await expect(page.getByRole('list', { name: labels.preview.remove })).toContainText('AAPL');
    await expect(page.getByLabel('Moneda de IBIT')).toHaveValue('ARS');

    await page.getByRole('button', { name: labels.cancel }).click();

    await expect(page.getByLabel(labels.fileLabel)).toHaveCount(0);
    await expect(holdingRows(page)).toHaveCount(1);
    await expect(holdingRows(page).first()).toContainText('AAPL');
  });

  await test.step('AC-03 and AC-09 confirm leaves exactly the holdings of the file, SPY in USD', async () => {
    await openImport(page);
    await page.getByLabel(labels.fileLabel).setInputFiles(workbook);
    await page.getByLabel('Moneda de SPY').selectOption('USD');
    await page.getByRole('button', { name: labels.confirm }).click();

    await expect(
      page.getByText('Importado: 2 agregadas, 0 actualizadas, 1 quitadas.'),
    ).toBeVisible();
    await expect(holdingRows(page)).toHaveCount(2);
    await expect(holdingRows(page).filter({ hasText: 'IBIT' })).toHaveCount(1);
    await expect(holdingRows(page).filter({ hasText: 'SPY' })).toContainText('USD');
    await expect(holdingRows(page).filter({ hasText: 'AAPL' })).toHaveCount(0);
  });

  await test.step('AC-05 and AC-07 a file that is not a Balanz spreadsheet is refused and nothing changes', async () => {
    await openImport(page);
    await page.getByLabel(labels.fileLabel).setInputFiles({
      name: 'resumen.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7 not a spreadsheet'),
    });

    await expect(card(page, PORTFOLIO).getByRole('alert')).toContainText(labels.errors.notExcel);
    await expect(page.getByRole('button', { name: labels.confirm })).toHaveCount(0);
    await expect(holdingRows(page)).toHaveCount(2);
  });
});
