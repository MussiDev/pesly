import { expect, test } from '@playwright/test';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';
import {
  addGhostMember,
  createGroup,
  createInvitationLink,
  scrollsHorizontally,
  signedInUser,
} from './support/groups';

const t = catalogs.es.groups;
const tCategories = catalogs.es.categories;

// The emails and the helpers read the Spanish copy.
test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

test.beforeEach(async () => {
  await resetAttemptLimits();
});

test('two users: create, invite, join, add a member without an account, add a category and leave (AC-03, AC-07, AC-16)', async ({
  browser,
}) => {
  const contextA = await browser.newContext({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
  const contextB = await browser.newContext({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    await signedInUser(pageA, 'groups-a', 'Ana Pérez');
    await signedInUser(pageB, 'groups-b', 'Bruno Gómez');

    // A creates the group and an invitation.
    const groupId = await createGroup(pageA, 'Casa de playa');
    await expect(pageA.getByRole('list', { name: t.detail.membersTitle })).toContainText(
      'Ana Pérez',
    );
    const link = await createInvitationLink(pageA);

    // B opens the link and lands in the group.
    await pageB.goto(link);
    await expect(pageB).toHaveURL(new RegExp(`/es/groups/${groupId}$`));
    await expect(pageB.getByRole('heading', { level: 1, name: 'Casa de playa' })).toBeVisible();
    await expect(pageB.getByRole('list', { name: t.detail.membersTitle })).toContainText(
      'Bruno Gómez',
    );

    // NFR-04: the one-time token is gone from the address and from the history behind it.
    const token = new URL(link).hash.replace('#token=', '');
    expect(token).not.toBe('');
    expect(pageB.url()).not.toContain('token');
    expect(pageB.url()).not.toContain(token);
    await pageB.goBack();
    expect(pageB.url()).not.toContain('token');
    expect(pageB.url()).not.toContain(token);
    await pageB.goForward();
    await expect(pageB).toHaveURL(new RegExp(`/es/groups/${groupId}$`));

    // A reloads and sees B; then adds a member without an account and a group category.
    await pageA.reload();
    const members = pageA.getByRole('list', { name: t.detail.membersTitle });
    await expect(members).toContainText('Bruno Gómez');
    await addGhostMember(pageA, 'Carla');
    await expect(members).toContainText(t.detail.ghost);

    await pageA.getByRole('link', { name: t.detail.categoriesLink }).click();
    await expect(pageA.getByRole('heading', { level: 1, name: t.categories.title })).toBeVisible();
    await pageA.getByLabel(tCategories.fields.name, { exact: true }).fill('Supermercado playa');
    await pageA.getByRole('radio', { name: tCategories.icons.car, exact: true }).check({
      force: true,
    });
    await pageA.getByRole('radio', { name: tCategories.colors.blue, exact: true }).check({
      force: true,
    });
    await pageA.getByRole('button', { name: t.categories.submit }).click();
    await expect(
      pageA
        .getByRole('list', { name: t.categories.listLabel })
        .getByText('Supermercado playa', { exact: true }),
    ).toBeVisible();

    // B has no balance, so B leaves and is back on the list without the group.
    await pageB.getByRole('button', { name: t.detail.leave.action }).click();
    await expect(pageB).toHaveURL(/\/es\/groups$/);
    await expect(pageB.getByText(t.list.empty.title)).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('an invalid invitation link shows the invalid-link message', async ({ page }) => {
  await signedInUser(page, 'groups-invalid');

  await page.goto('/es/groups/join#token=not-a-real-token');
  await expect(page.getByText(t.join.join.invalid)).toBeVisible();
  await expect(page.getByRole('link', { name: t.join.backToGroups })).toBeVisible();

  // A link with no token at all is the same dead end.
  await page.goto('/es/groups/join');
  await expect(page.getByText(t.join.join.invalid)).toBeVisible();
});

test('the groups list and the group detail fit a 360 px viewport (NFR-01)', async ({ page }) => {
  await signedInUser(page, 'groups-narrow');
  await page.setViewportSize({ width: 360, height: 740 });

  await createGroup(page, 'Viaje largo con un nombre bastante extenso ok');
  await createInvitationLink(page);
  await addGhostMember(page, 'Persona con un nombre muy largo sin cuenta');
  expect(await scrollsHorizontally(page)).toBe(false);

  await page.goto('/es/groups');
  await expect(page.getByRole('list', { name: t.list.label })).toBeVisible();
  expect(await scrollsHorizontally(page)).toBe(false);
});
