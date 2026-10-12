// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GroupActivityContainer } from '../src/features/groups/activity/group-activity-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const GROUP_ID = '55555555-5555-4555-8555-555555555555';
const ANA = '77777777-7777-4777-8777-777777777771';
const BEA = '77777777-7777-4777-8777-777777777772';
const GET_GROUP = `GET /groups/${GROUP_ID}`;
const FIRST_PAGE = `GET /groups/${GROUP_ID}/activity?limit=50`;

const member = (id: string, displayName: string, role = 'member') => ({
  id,
  displayName,
  isGhost: false,
  role,
  joinedAt: '2026-10-01T00:00:00.000Z',
});

const group = {
  id: GROUP_ID,
  name: 'Flatmates',
  defaultRateType: 'blue',
  role: 'member',
  memberCount: 2,
  createdAt: '2026-10-01T00:00:00.000Z',
  selfMemberId: ANA,
  members: [member(ANA, 'Ana', 'admin'), member(BEA, 'Bea')],
  formerMembers: [],
};

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'e1',
  action: 'expense_created',
  subjectType: 'expense',
  subjectId: 'subject-1',
  memberId: ANA,
  createdAt: '2026-10-11T12:00:00.000Z',
  before: null,
  after: null,
  fromMovement: false,
  autoCategory: null,
  ...overrides,
});

const open = (items: object[], locale: 'en' | 'es' = 'en') => {
  stubApi({
    [GET_GROUP]: { status: 200, body: group },
    [FIRST_PAGE]: { status: 200, body: { items, nextCursor: null } },
  });
  return renderApp(<GroupActivityContainer groupId={GROUP_ID} />, { locale });
};

describe('activity marker for an expense created from a movement', () => {
  it('shows the marker only when fromMovement is true (AC-18)', async () => {
    open([entry({ id: 'e2', fromMovement: true }), entry({ id: 'e1' })]);
    const rows = await screen.findAllByRole('listitem');
    expect(within(rows[0] as HTMLElement).getByText(en.groups.activity.fromMovement)).toBeTruthy();
    expect(within(rows[1] as HTMLElement).queryByText(en.groups.activity.fromMovement)).toBeNull();
  });

  it.each([
    ['en', en],
    ['es', es],
  ] as const)(
    'shows the %s marker text and no account or movement id (AC-18, AC-34)',
    async (locale, cat) => {
      const { container } = open(
        [entry({ fromMovement: true, subjectId: 'mov-secret-id' })],
        locale,
      );
      const row = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
      expect(cat.groups.activity.fromMovement.length).toBeGreaterThan(0);
      expect(within(row).getByText(cat.groups.activity.fromMovement)).toBeTruthy();
      expect(container.textContent).not.toContain('mov-secret-id');
    },
  );

  it.each([
    ['en', en],
    ['es', es],
  ] as const)(
    'shows the automatic category texts in %s next to the sender (AC-52)',
    async (locale, cat) => {
      open(
        [
          entry({ id: 'e3', fromMovement: true, autoCategory: 'created' }),
          entry({ id: 'e2', fromMovement: true, autoCategory: 'restored' }),
          entry({ id: 'e1', fromMovement: true }),
        ],
        locale,
      );
      const rows = await screen.findAllByRole('listitem');
      const created = within(rows[0] as HTMLElement);
      expect(created.getByText(cat.groups.activity.autoCategoryCreated)).toBeTruthy();
      expect(created.getAllByText('Ana')).toHaveLength(2);
      expect(created.queryByText(cat.groups.activity.autoCategoryRestored)).toBeNull();
      const restored = within(rows[1] as HTMLElement);
      expect(restored.getByText(cat.groups.activity.autoCategoryRestored)).toBeTruthy();
      expect(restored.queryByText(cat.groups.activity.autoCategoryCreated)).toBeNull();
      const none = within(rows[2] as HTMLElement);
      expect(none.queryByText(cat.groups.activity.autoCategoryCreated)).toBeNull();
      expect(none.queryByText(cat.groups.activity.autoCategoryRestored)).toBeNull();
    },
  );

  it.each([
    ['fromMovement missing', { fromMovement: undefined }],
    ['fromMovement not a boolean', { fromMovement: 'yes' }],
    ['autoCategory missing', { autoCategory: undefined }],
    ['autoCategory another value', { autoCategory: 'deleted' }],
  ])('fails the parse and shows the failure state when %s', async (_name, overrides) => {
    open([entry(overrides)]);
    expect(await screen.findByRole('button', { name: en.app.retry })).toBeTruthy();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('has the new keys, none empty, in both catalogs (NFR-04)', () => {
    for (const cat of [en, es]) {
      for (const key of ['fromMovement', 'autoCategoryCreated', 'autoCategoryRestored'] as const) {
        expect(cat.groups.activity[key].trim().length).toBeGreaterThan(0);
      }
    }
  });
});
