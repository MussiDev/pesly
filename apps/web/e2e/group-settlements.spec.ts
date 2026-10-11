import { formatMinorUnits } from '@pesly/shared';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';
import { createGroup, scrollsHorizontally, signedInUser } from './support/groups';
import {
  API_URL,
  groupFacts,
  leaveGroup,
  memberIdByName,
  seedExpense,
  seedSettlement,
  sharedGroup,
  type GroupFacts,
} from './support/group-settlements';

const t = catalogs.es.groups;
const tEn = catalogs.en.groups;

const ANA = 'Ana Pérez';
const BRUNO = 'Bruno Gómez';

const NBSP = String.fromCharCode(0xa0);
// The screens write an amount, a non-breaking space and the currency code.
const ars = (minor: bigint) => `${formatMinorUnits(minor, 'es')}${NBSP}ARS`;
const usd = (minor: bigint) => `${formatMinorUnits(minor, 'es')}${NBSP}USD`;

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

test.beforeEach(async () => {
  await resetAttemptLimits();
});

interface Pair {
  pageA: Page;
  pageB: Page;
  groupId: string;
  factsA: GroupFacts;
  factsB: GroupFacts;
}

/** Two signed-in users in one group; the caller closes the contexts it gets back. */
async function pairInGroup(
  browser: Browser,
  label: string,
  groupName: string,
): Promise<Pair & { close: () => Promise<void> }> {
  const options = { locale: 'es-AR', timezoneId: 'America/Cordoba' };
  const contextA = await browser.newContext(options);
  const contextB = await browser.newContext(options);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await signedInUser(pageA, `${label}-a`, ANA);
  await signedInUser(pageB, `${label}-b`, BRUNO);
  const groupId = await sharedGroup(pageA, pageB, groupName);
  return {
    pageA,
    pageB,
    groupId,
    factsA: await groupFacts(pageA, groupId),
    factsB: await groupFacts(pageB, groupId),
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

/** A pays 10,000.00 ARS split equally (Bruno owes 5,000.00); Bruno pays 100.00 USD (Ana owes 50.00). */
async function seedBothDebts(pair: Pair, label: string): Promise<void> {
  await seedExpense(pair.pageA, pair.groupId, pair.factsA, {
    amount: '1000000',
    currency: 'ARS',
    description: `Cena ${label}`,
  });
  await seedExpense(pair.pageB, pair.groupId, pair.factsB, {
    amount: '10000',
    currency: 'USD',
    description: `Hotel ${label}`,
  });
}

function section(page: Page, currency: 'ARS' | 'USD') {
  return page.getByRole('region', {
    name: t.balances.sectionLabel.replace('{currency}', currency),
  });
}

test('two users record suggested payments, with and without an own account, and read the history (AC-02, AC-06, AC-07, AC-10, AC-18, AC-20, AC-21)', async ({
  browser,
}) => {
  const pair = await pairInGroup(browser, 'gs-main', 'Casa de playa');
  const { pageA, pageB, groupId } = pair;
  try {
    await seedBothDebts(pair, 'main');

    // AC-20, AC-21: the detail shows the balances link and the caller's own balance.
    await pageB.goto(`/es/groups/${groupId}`);
    await expect(
      pageB.getByText(t.detail.ownBalance.owes.replace('{amount}', ars(500000n))),
    ).toBeVisible();
    await pageB.getByRole('link', { name: t.detail.balancesLink }).click();
    await expect(pageB).toHaveURL(new RegExp(`/es/groups/${groupId}/balances$`));

    // AC-02: the balances per currency and the suggested payments.
    const arsSection = section(pageB, 'ARS');
    const usdSection = section(pageB, 'USD');
    await expect(
      arsSection.getByText(
        t.balances.payment
          .replace('{payer}', BRUNO)
          .replace('{payee}', ANA)
          .replace('{amount}', ars(500000n)),
      ),
    ).toBeVisible();
    await expect(
      usdSection.getByText(
        t.balances.payment
          .replace('{payer}', ANA)
          .replace('{payee}', BRUNO)
          .replace('{amount}', usd(5000n)),
      ),
    ).toBeVisible();

    // AC-06: record the suggested ARS payment without an own account.
    await arsSection.getByRole('button', { name: t.balances.record, exact: true }).click();
    await expect(pageB.getByRole('heading', { name: t.settlement.title })).toBeVisible();
    const withoutAccount = pageB.waitForRequest(
      (request) =>
        request.method() === 'POST' && request.url() === `${API_URL}/groups/${groupId}/settlements`,
    );
    await pageB.getByRole('button', { name: t.settlement.submit, exact: true }).click();
    const sent = (await withoutAccount).postDataJSON() as Record<string, unknown>;
    expect(sent.amount).toBe('500000');
    expect(sent).not.toHaveProperty('accountId');
    await expect(arsSection.getByText(t.balances.settled)).toBeVisible();

    // AC-07: the other member sees the new balance.
    await pageA.goto(`/es/groups/${groupId}/balances`);
    await expect(section(pageA, 'ARS').getByText(t.balances.settled)).toBeVisible();
    await expect(
      section(pageA, 'USD').getByText(
        t.balances.payment
          .replace('{payer}', ANA)
          .replace('{payee}', BRUNO)
          .replace('{amount}', usd(5000n)),
      ),
    ).toBeVisible();

    // AC-10, AC-18: a second debt, paid from Bruno's own account; the account is sent.
    await seedExpense(pageA, groupId, pair.factsA, {
      amount: '200000',
      currency: 'ARS',
      description: 'Helado',
    });
    await pageB.goto(`/es/groups/${groupId}/balances`);
    await section(pageB, 'ARS')
      .getByRole('button', { name: t.balances.record, exact: true })
      .click();
    await pageB
      .getByLabel(t.settlement.fields.account, { exact: true })
      .selectOption({ label: 'Banco ARS' });
    const withAccount = pageB.waitForRequest(
      (request) =>
        request.method() === 'POST' && request.url() === `${API_URL}/groups/${groupId}/settlements`,
    );
    await pageB.getByRole('button', { name: t.settlement.submit, exact: true }).click();
    const sentWithAccount = (await withAccount).postDataJSON() as Record<string, unknown>;
    expect(sentWithAccount.amount).toBe('100000');
    expect(typeof sentWithAccount.accountId).toBe('string');
    await expect(section(pageB, 'ARS').getByText(t.balances.settled)).toBeVisible();

    // The history lists both payments, newest first.
    await pageB.getByRole('link', { name: t.balances.historyLink }).click();
    await expect(pageB).toHaveURL(new RegExp(`/es/groups/${groupId}/settlements$`));
    await expect(pageB.getByRole('heading', { level: 1, name: t.settlements.title })).toBeVisible();
    const parties = t.settlements.parties.replace('{payer}', BRUNO).replace('{payee}', ANA);
    await expect(pageB.getByText(parties)).toHaveCount(2);
    await expect(pageB.getByText(ars(500000n), { exact: true })).toBeVisible();
    await expect(pageB.getByText(ars(100000n), { exact: true })).toBeVisible();
  } finally {
    await pair.close();
  }
});

test('consolidation with the prefilled rate and with a manual rate, and a stale preview (AC-12, AC-14, AC-16, AC-17)', async ({
  browser,
}) => {
  const pair = await pairInGroup(browser, 'gs-consolidate', 'Viaje largo');
  const { pageA, groupId } = pair;
  try {
    await seedBothDebts(pair, 'one');
    const bruno = memberIdByName(pair.factsA, BRUNO);

    await pageA.goto(`/es/groups/${groupId}/settlements/consolidate`);
    await expect(pageA.getByRole('heading', { level: 1, name: t.consolidate.title })).toBeVisible();
    await pageA.getByLabel(t.consolidate.fields.memberB, { exact: true }).selectOption(bruno);
    await expect(
      pageA.getByText(
        t.consolidate.legs.pays
          .replace('{payer}', BRUNO)
          .replace('{payee}', ANA)
          .replace('{amount}', ars(500000n)),
        { exact: true },
      ),
    ).toBeVisible();
    // AC-12: the stored rate is prefilled.
    const rate = pageA.getByLabel(t.consolidate.fields.rate, { exact: true });
    await expect(rate).not.toHaveValue('');
    await expect(rate).not.toHaveValue('0');

    // AC-17: the balance moves between the preview and the record.
    await seedExpense(pageA, groupId, pair.factsA, {
      amount: '200000',
      currency: 'ARS',
      description: 'Extra',
    });
    await pageA.getByRole('button', { name: t.consolidate.record, exact: true }).click();
    await expect(pageA.getByText(t.consolidate.stale)).toBeVisible();
    await expect(
      pageA.getByText(
        t.consolidate.legs.pays
          .replace('{payer}', BRUNO)
          .replace('{payee}', ANA)
          .replace('{amount}', ars(600000n)),
        { exact: true },
      ),
    ).toBeVisible();

    // AC-14: confirming again records the payment with the prefilled rate.
    await pageA.getByRole('button', { name: t.consolidate.record, exact: true }).click();
    await expect(pageA.getByText(t.consolidate.done.title)).toBeVisible();
    await pageA.goto(`/es/groups/${groupId}/balances`);
    await expect(pageA.getByText(t.balances.settled)).toHaveCount(2);

    // AC-16: a manual rate settles a second pair of debts the same way.
    await seedBothDebts(pair, 'two');
    await pageA.goto(`/es/groups/${groupId}/settlements/consolidate`);
    await pageA.getByLabel(t.consolidate.fields.memberB, { exact: true }).selectOption(bruno);
    await expect(rate).not.toHaveValue('');
    await rate.fill('1200');
    const body = pageA.waitForRequest(
      (request) =>
        request.method() === 'POST' && request.url() === `${API_URL}/groups/${groupId}/settlements`,
    );
    await pageA.getByRole('button', { name: t.consolidate.record, exact: true }).click();
    const sent = (await body).postDataJSON() as Record<string, unknown>;
    expect(sent.rate).toBe('12000000');
    await expect(pageA.getByText(t.consolidate.done.title)).toBeVisible();
    await pageA.goto(`/es/groups/${groupId}/balances`);
    await expect(pageA.getByText(t.balances.settled)).toHaveCount(2);

    // The consolidated payments are marked in the history.
    await pageA.goto(`/es/groups/${groupId}/settlements`);
    await expect(pageA.getByText(t.settlements.consolidated, { exact: true })).toHaveCount(2);
  } finally {
    await pair.close();
  }
});

test('the history pages with load more and repeats nothing (AC-19)', async ({ browser }) => {
  const pair = await pairInGroup(browser, 'gs-history', 'Historial largo');
  try {
    const bruno = memberIdByName(pair.factsA, BRUNO);
    for (let index = 1; index <= 51; index += 1) {
      await seedSettlement(pair.pageA, pair.groupId, pair.factsA, {
        toMemberId: bruno,
        amount: String(index * 100),
        currency: 'ARS',
      });
    }
    await pair.pageA.goto(`/es/groups/${pair.groupId}/settlements`);
    const rows = pair.pageA.locator('main ul > li');
    await expect(rows).toHaveCount(50);
    await pair.pageA.getByRole('button', { name: t.settlements.loadMore }).click();
    await expect(rows).toHaveCount(51);
    await expect(pair.pageA.getByRole('button', { name: t.settlements.loadMore })).toHaveCount(0);
    const texts = await rows.allInnerTexts();
    expect(new Set(texts).size).toBe(51);
  } finally {
    await pair.close();
  }
});

test('the balances, the form, the consolidation and the history fit 360 px, and render in English (NFR-01, NFR-03, AC-22)', async ({
  browser,
}) => {
  const pair = await pairInGroup(
    browser,
    'gs-narrow',
    'Viaje largo con un nombre bastante extenso ok',
  );
  const { pageA, groupId } = pair;
  try {
    await seedBothDebts(pair, 'narrow');
    await seedSettlement(pageA, groupId, pair.factsA, {
      toMemberId: memberIdByName(pair.factsA, BRUNO),
      amount: '12345',
      currency: 'ARS',
    });
    await pageA.setViewportSize({ width: 360, height: 740 });

    await pageA.goto(`/es/groups/${groupId}/balances`);
    await expect(section(pageA, 'ARS')).toBeVisible();
    expect(await scrollsHorizontally(pageA)).toBe(false);

    await pageA.getByRole('button', { name: t.balances.recordPayment, exact: true }).click();
    await expect(pageA.getByRole('heading', { name: t.settlement.title })).toBeVisible();
    expect(await scrollsHorizontally(pageA)).toBe(false);

    await pageA.goto(`/es/groups/${groupId}/settlements/consolidate`);
    await pageA
      .getByLabel(t.consolidate.fields.memberB, { exact: true })
      .selectOption(memberIdByName(pair.factsA, BRUNO));
    await expect(pageA.getByLabel(t.consolidate.fields.rate, { exact: true })).not.toHaveValue('');
    expect(await scrollsHorizontally(pageA)).toBe(false);

    await pageA.goto(`/es/groups/${groupId}/settlements`);
    await expect(pageA.getByText(t.settlements.consolidated)).toHaveCount(0);
    await expect(pageA.locator('main ul > li')).toHaveCount(1);
    expect(await scrollsHorizontally(pageA)).toBe(false);

    // NFR-03, AC-22: the same screens in English.
    await pageA.goto(`/en/groups/${groupId}/balances`);
    await expect(
      pageA.getByRole('button', { name: tEn.balances.recordPayment, exact: true }),
    ).toBeVisible();
    await pageA.goto(`/en/groups/${groupId}/settlements/consolidate`);
    await expect(
      pageA.getByRole('heading', { level: 1, name: tEn.consolidate.title }),
    ).toBeVisible();
    await pageA.goto(`/en/groups/${groupId}/settlements`);
    await expect(
      pageA.getByRole('heading', { level: 1, name: tEn.settlements.title }),
    ).toBeVisible();
  } finally {
    await pair.close();
  }
});

test('the balances page makes at most 2 API requests on load (NFR-02)', async ({ page }) => {
  await signedInUser(page, 'gs-requests', ANA);
  const groupId = await createGroup(page, 'Pocas llamadas');

  const calls: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(API_URL)) calls.push(new URL(request.url()).pathname);
  });
  await page.goto(`/es/groups/${groupId}/balances`);
  await expect(section(page, 'ARS')).toBeVisible();
  // `next dev` mounts every effect twice (React strict mode), so the development server asks
  // each resource twice; a production build, as CI runs, asks once.
  // The shell adds its own session and notices requests; the screen asks for the group and the balances.
  const own = calls.filter((path) => path.startsWith('/groups'));
  expect([...new Set(own)].sort()).toEqual([`/groups/${groupId}`, `/groups/${groupId}/balances`]);
  const production = Boolean(process.env.CI) || process.env.E2E_PRODUCTION_BUILD === '1';
  if (production) expect(own.length).toBeLessThanOrEqual(2);
});

test('a user outside the group gets the not-found state, and a malformed id shows no data (AC-23)', async ({
  browser,
}) => {
  const pair = await pairInGroup(browser, 'gs-outsider', 'Privado');
  const outsider = await browser.newContext({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
  try {
    const page = await outsider.newPage();
    await signedInUser(page, 'gs-outsider-c', 'Carla Ruiz');
    for (const path of ['balances', 'settlements', 'settlements/consolidate']) {
      await page.goto(`/es/groups/${pair.groupId}/${path}`);
      await expect(
        page.getByText(t.detail.notFound.title).or(page.getByText(t.balances.notFound.title)),
      ).toBeVisible();
    }

    // An id that is no group of the user's: an error with a retry, never someone else's data.
    await page.goto('/es/groups/not-a-valid-id/balances');
    await expect(page.getByRole('button', { name: catalogs.es.app.retry })).toBeVisible();
    await expect(page.getByRole('button', { name: t.balances.recordPayment })).toHaveCount(0);
  } finally {
    await outsider.close();
    await pair.close();
  }
});

test('a member who left meanwhile is rejected by the server with a message (invalid input)', async ({
  browser,
}) => {
  const pair = await pairInGroup(browser, 'gs-left', 'Se fue');
  const { pageA, pageB, groupId } = pair;
  try {
    await pageA.goto(`/es/groups/${groupId}/balances`);
    await pageA.getByRole('button', { name: t.balances.recordPayment, exact: true }).click();
    await pageA.getByLabel(t.settlement.fields.from, { exact: true }).selectOption({ label: ANA });
    await pageA.getByLabel(t.settlement.fields.to, { exact: true }).selectOption({ label: BRUNO });
    await pageA.getByLabel(t.settlement.fields.amount, { exact: true }).fill('10');

    await leaveGroup(pageB, groupId);

    await pageA.getByRole('button', { name: t.settlement.submit, exact: true }).click();
    const refusal = pageA.locator('form').getByRole('alert');
    await expect(refusal).toBeVisible();
    await expect(refusal).not.toHaveText('');
    await expect(
      pageA.getByRole('button', { name: t.settlement.submit, exact: true }),
    ).toBeEnabled();
  } finally {
    await pair.close();
  }
});
