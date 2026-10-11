// @vitest-environment happy-dom
import { defaultCategoryName } from '@pesly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { GroupCategoriesContainer } from '../src/features/groups/containers/group-categories-container';
import { buildGroupCategoryRequest } from '../src/features/groups/category-request';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en } = CATALOGS;
const GROUP_ID = '55555555-5555-4555-8555-555555555555';
const FOOD = '66666666-6666-4666-8666-666666666661';
const TRIP = '66666666-6666-4666-8666-666666666662';
const OLD = '66666666-6666-4666-8666-666666666663';
const NEW_ID = '66666666-6666-4666-8666-666666666664';
const GET_GROUP = `GET /groups/${GROUP_ID}`;
const LIST = `GET /groups/${GROUP_ID}/categories`;
const CREATE = `POST /groups/${GROUP_ID}/categories`;
const PATCH = (id: string) => `PATCH /groups/${GROUP_ID}/categories/${id}`;

const group = (role: 'admin' | 'member') => ({
  id: GROUP_ID,
  name: 'Flatmates',
  defaultRateType: 'blue',
  role,
  memberCount: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  selfMemberId: 'self-member',
  members: [],
  formerMembers: [],
});

const category = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  defaultKey: null,
  name: 'Trip',
  icon: 'plane',
  color: 'blue',
  archivedAt: null,
  ...overrides,
});

const CATEGORIES = [
  category(FOOD, { defaultKey: 'food', name: null, icon: 'utensils', color: 'orange' }),
  category(TRIP),
  category(OLD, { name: 'Old', archivedAt: '2026-10-02T00:00:00.000Z' }),
];

const rowOf = (name: string) => {
  const row = screen.getByText(name).closest('li');
  if (!row) throw new Error(`No row for ${name}`);
  return row;
};

const open = (locale: 'en' | 'es' = 'en') =>
  renderApp(<GroupCategoriesContainer groupId={GROUP_ID} />, { locale });

const adminRoutes = (extra: Record<string, object> = {}) => ({
  [GET_GROUP]: { status: 200, body: group('admin') },
  [LIST]: { status: 200, body: CATEGORIES },
  ...extra,
});

describe('buildGroupCategoryRequest', () => {
  it('trims the name and keeps a valid icon and color', () => {
    expect(buildGroupCategoryRequest({ name: '  Trip ', icon: 'plane', color: 'blue' })).toEqual({
      request: { name: 'Trip', icon: 'plane', color: 'blue' },
    });
  });

  it('names the catalog path of each invalid field', () => {
    expect(buildGroupCategoryRequest({ name: '   ', icon: '', color: 'nope' }).fields).toEqual({
      name: 'categories.errors.nameRequired',
      icon: 'categories.errors.iconRequired',
      color: 'categories.errors.colorRequired',
    });
    expect(
      buildGroupCategoryRequest({ name: 'x'.repeat(200), icon: 'plane', color: 'blue' }).fields,
    ).toEqual({ name: 'categories.errors.nameTooLong' });
  });
});

describe('GroupCategoriesContainer', () => {
  it('lists default and custom categories and marks archived ones (AC-19)', async () => {
    const { calls } = stubApi(adminRoutes());
    open();

    expect(await screen.findByText(defaultCategoryName('food', 'en'))).toBeTruthy();
    expect(screen.getByText('Trip')).toBeTruthy();
    expect(within(rowOf('Old')).getByText(en.groups.categories.archivedBadge)).toBeTruthy();
    expect(within(rowOf('Trip')).queryByText(en.groups.categories.archivedBadge)).toBeNull();
    // NFR-02: the group (for the role) and its categories, nothing more.
    expect(calls.length).toBeLessThanOrEqual(2);
    expect(calls.map((call) => call.path).sort()).toEqual(
      [`/groups/${GROUP_ID}`, `/groups/${GROUP_ID}/categories`].sort(),
    );
  });

  it('names defaults from the catalog in the locale of the page', async () => {
    stubApi(adminRoutes());
    open('es');
    expect(await screen.findByText(defaultCategoryName('food', 'es'))).toBeTruthy();
  });

  it('lets an admin create a category and shows it (AC-19)', async () => {
    const created = category(NEW_ID, { name: 'Gifts', icon: 'gift', color: 'pink' });
    const { calls } = stubApi(adminRoutes({ [CREATE]: { status: 201, body: created } }));
    open();
    await screen.findByText('Trip');

    await userEvent.type(screen.getByLabelText(en.categories.fields.name), '  Gifts ');
    await userEvent.click(screen.getByRole('radio', { name: en.categories.icons.gift }));
    await userEvent.click(screen.getByRole('radio', { name: en.categories.colors.pink }));
    await userEvent.click(screen.getByRole('button', { name: en.groups.categories.submit }));

    expect(await screen.findByText('Gifts')).toBeTruthy();
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.body).toEqual({ name: 'Gifts', icon: 'gift', color: 'pink' });
  });

  it('lets an admin edit a category and shows the new name (AC-19)', async () => {
    const edited = category(TRIP, { name: 'Holidays' });
    const { calls } = stubApi(adminRoutes({ [PATCH(TRIP)]: { status: 200, body: edited } }));
    open();
    await screen.findByText('Trip');

    await userEvent.click(
      screen.getByRole('button', { name: `${en.categories.actions.edit} Trip` }),
    );
    const input = screen.getByLabelText(en.categories.actions.editField.replace('{name}', 'Trip'));
    await userEvent.clear(input);
    await userEvent.type(input, 'Holidays');
    await userEvent.click(screen.getByRole('button', { name: en.categories.actions.save }));

    expect(await screen.findByText('Holidays')).toBeTruthy();
    expect(screen.queryByText('Trip')).toBeNull();
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({ name: 'Holidays', icon: 'plane', color: 'blue' });
  });

  it('archives and restores a category (AC-19)', async () => {
    const { calls } = stubApi(
      adminRoutes({
        [PATCH(TRIP)]: {
          status: 200,
          body: category(TRIP, { archivedAt: '2026-10-03T00:00:00.000Z' }),
        },
        [PATCH(OLD)]: { status: 200, body: category(OLD, { name: 'Old' }) },
      }),
    );
    open();
    await screen.findByText('Trip');

    await userEvent.click(
      screen.getByRole('button', { name: `${en.categories.actions.archive} Trip` }),
    );
    await waitFor(() => {
      expect(within(rowOf('Trip')).getByText(en.groups.categories.archivedBadge)).toBeTruthy();
    });
    expect(calls.find((call) => call.path.endsWith(TRIP))?.body).toEqual({ archived: true });

    await userEvent.click(
      screen.getByRole('button', { name: `${en.groups.categories.actions.restore} Old` }),
    );
    await waitFor(() => {
      expect(within(rowOf('Old')).queryByText(en.groups.categories.archivedBadge)).toBeNull();
    });
    expect(calls.find((call) => call.path.endsWith(OLD))?.body).toEqual({ archived: false });
  });

  it('shows a regular member a read-only list with no controls (AC-15)', async () => {
    stubApi({
      [GET_GROUP]: { status: 200, body: group('member') },
      [LIST]: { status: 200, body: CATEGORIES },
    });
    open();
    await screen.findByText('Trip');

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText(en.groups.categories.readOnly)).toBeTruthy();
  });

  it('shows a field error for a duplicate name and keeps the list', async () => {
    stubApi(adminRoutes({ [CREATE]: { status: 409, body: { code: 'CATEGORY_NAME_TAKEN' } } }));
    open();
    await screen.findByText('Trip');

    await userEvent.type(screen.getByRole('textbox'), 'Trip');
    await userEvent.click(screen.getByRole('radio', { name: en.categories.icons.gift }));
    await userEvent.click(screen.getByRole('radio', { name: en.categories.colors.pink }));
    await userEvent.click(screen.getByRole('button', { name: en.groups.categories.submit }));

    expect(await screen.findByText(en.errors.categoryNameTaken)).toBeTruthy();
    expect(screen.getAllByText('Trip')).toHaveLength(1);
  });

  it('flags an empty name next to its field and sends no request', async () => {
    const { calls } = stubApi(adminRoutes());
    open();
    await screen.findByText('Trip');
    const before = calls.length;

    await userEvent.type(screen.getByRole('textbox'), '   ');
    await userEvent.click(screen.getByRole('button', { name: en.groups.categories.submit }));

    expect(await screen.findByText(en.categories.errors.nameRequired)).toBeTruthy();
    expect(calls).toHaveLength(before);
  });

  it('shows the 403 message and leaves the list untouched', async () => {
    stubApi(
      adminRoutes({ [PATCH(TRIP)]: { status: 403, body: { code: 'GROUP_ADMIN_REQUIRED' } } }),
    );
    open();
    await screen.findByText('Trip');

    await userEvent.click(
      screen.getByRole('button', { name: `${en.categories.actions.archive} Trip` }),
    );

    expect(await screen.findByText(en.errors.groupAdminRequired)).toBeTruthy();
    expect(within(rowOf('Trip')).queryByText(en.groups.categories.archivedBadge)).toBeNull();
  });

  it('shows the not-found state with a link to the groups on a 404', async () => {
    stubApi({
      [GET_GROUP]: { status: 404, body: { code: 'NOT_FOUND' } },
      [LIST]: { status: 404, body: { code: 'NOT_FOUND' } },
    });
    open();

    const link = await screen.findByRole('link', { name: en.groups.detail.notFound.back });
    expect(link.getAttribute('href')).toBe('/en/groups');
  });
});
