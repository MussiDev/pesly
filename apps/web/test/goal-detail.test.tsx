// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GoalDetailContainer } from '../src/features/goals/detail/goal-detail-container';
import { formatDateTime, formatMoney } from '../src/lib/format-amount';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

// Block 3 and Block 6 own these components; they are replaced by stubs here (spec D8).
vi.mock('../src/features/goals/list/goal-progress', () => ({
  GoalProgress: ({ goal }: { goal: { name: string; progress: bigint } }) => (
    <div data-testid="goal-progress">
      {goal.name} progress:{String(goal.progress)}
    </div>
  ),
}));

const recordedResponse = {
  entry: {
    id: '33333333-3333-4333-8333-333333333399',
    kind: 'contribution',
    amount: '20000',
    createdAt: '2026-10-11T18:00:00.000Z',
  },
  goal: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Trip',
    targetAmount: '1000000',
    currency: 'ARS',
    targetDate: null,
    accountId: null,
    progress: '320000',
    percentage: 32,
    status: 'active',
    monthlyAmountNeeded: null,
    createdAt: '2026-10-01T00:00:00.000Z',
  },
};

vi.mock('../src/features/goals/entries/goal-entry-actions', () => ({
  GoalEntryActions: ({
    goal,
    onRecorded,
  }: {
    goal: { accountId: string | null };
    onRecorded: (response: unknown) => void;
  }) => (
    <div data-testid="entry-actions">
      {goal.accountId === null ? 'forms' : 'linked-notice'}
      <button
        type="button"
        onClick={() => {
          onRecorded(recordedResponse);
        }}
      >
        stub-record
      </button>
    </div>
  ),
}));

vi.mock('../src/features/goals/delete/goal-delete-action', () => ({
  GoalDeleteAction: ({ goalId, onDeleted }: { goalId: string; onDeleted: () => void }) => (
    <button type="button" data-goal={goalId} onClick={onDeleted}>
      stub-delete
    </button>
  ),
}));

const { en, es } = CATALOGS;
const GOAL_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const NBSP = String.fromCharCode(0xa0);
const money = (value: bigint, currency: 'ARS' | 'USD', language: 'en' | 'es' = 'en'): string =>
  formatMoney(value, currency, language).replaceAll(NBSP, ' ');
const LATEST_NOTE = en.goals.detail.entries.latestNote.replace('{count}', '100');
const GET_GOAL = `GET /goals/${GOAL_ID}`;
const FIRST = `GET /goals/${GOAL_ID}/entries?limit=50`;
const SECOND = `GET /goals/${GOAL_ID}/entries?limit=100`;

const goal = (overrides: Record<string, unknown> = {}) => ({
  ...recordedResponse.goal,
  progress: '300000',
  percentage: 30,
  ...overrides,
});

const entry = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`,
  kind: 'contribution',
  amount: '10000',
  createdAt: '2026-10-10T12:00:00.000Z',
  ...overrides,
});

const entries = (count: number, from = 1) =>
  Array.from({ length: count }, (_, i) => entry(from + i, { amount: String(1000 + from + i) }));

const open = (locale: 'en' | 'es' = 'en', id = GOAL_ID) =>
  renderApp(<GoalDetailContainer goalId={id} />, { locale });

const ok = (body: unknown) => ({ status: 200, body });
const notFound = { status: 404, body: { code: 'NOT_FOUND', message: 'x' } };

describe('GoalDetailContainer', () => {
  it('shows the figures and the entries newest first with kind, amount and date (AC-08)', async () => {
    stubApi({
      [GET_GOAL]: ok(goal()),
      [FIRST]: ok({
        entries: [
          entry(2, { kind: 'withdrawal', amount: '5000', createdAt: '2026-10-11T13:00:00.000Z' }),
          entry(1),
        ],
      }),
    });
    open();

    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(screen.getByTestId('goal-progress').textContent).toContain('Trip');
    const first = within(rows[0] as HTMLElement);
    expect(first.getByText(en.goals.detail.entries.withdrawal)).toBeTruthy();
    expect(first.getByText(money(5000n, 'ARS'))).toBeTruthy();
    expect(first.getByText(formatDateTime('2026-10-11T13:00:00.000Z', 'UTC', 'en'))).toBeTruthy();
    const second = within(rows[1] as HTMLElement);
    expect(second.getByText(en.goals.detail.entries.contribution)).toBeTruthy();
    expect(second.getByText(money(10000n, 'ARS'))).toBeTruthy();
    expect(screen.queryByText(LATEST_NOTE)).toBeNull();
    expect(screen.getByRole('link', { name: en.goals.detail.edit }).getAttribute('href')).toBe(
      `/en/goals/${GOAL_ID}/edit`,
    );
    expect(screen.getByRole('button', { name: 'stub-delete' })).toBeTruthy();
  });

  it('says there are no entries yet for an unlinked goal without history', async () => {
    stubApi({ [GET_GOAL]: ok(goal()), [FIRST]: ok({ entries: [] }) });
    open();
    expect(await screen.findByText(en.goals.detail.entries.empty)).toBeTruthy();
  });

  it('shows the not-found state to a missing or foreign goal (AC-09)', async () => {
    stubApi({ [GET_GOAL]: notFound, [FIRST]: notFound });
    open();
    expect(await screen.findByText(en.goals.detail.notFound.title)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: en.goals.detail.notFound.back }).getAttribute('href'),
    ).toBe('/en/goals');
  });

  it('shows not-found for a malformed id and sends no request (invalid input)', async () => {
    const { calls } = stubApi({});
    open('en', 'not-a-uuid');
    expect(await screen.findByText(en.goals.detail.notFound.title)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('"Load more" asks for the next larger limit and shows the extra entries (AC-10)', async () => {
    const { calls } = stubApi({
      [GET_GOAL]: ok(goal()),
      [FIRST]: ok({ entries: entries(50) }),
      [SECOND]: ok({ entries: entries(70) }),
    });
    open();
    await screen.findAllByRole('listitem');
    expect(screen.getAllByRole('listitem')).toHaveLength(50);

    await userEvent.click(screen.getByRole('button', { name: en.goals.detail.entries.loadMore }));

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(70);
    });
    expect(calls.filter((call) => call.path === `/goals/${GOAL_ID}`)).toHaveLength(1);
    expect(calls.filter((call) => call.path.endsWith('limit=50'))).toHaveLength(1);
    expect(calls.filter((call) => call.path.endsWith('limit=100'))).toHaveLength(1);
  });

  it('shows the latest-entries note only when the list is at the 100 cap', async () => {
    stubApi({
      [GET_GOAL]: ok(goal()),
      [FIRST]: ok({ entries: entries(50) }),
      [SECOND]: ok({ entries: entries(100) }),
    });
    open();
    await screen.findAllByRole('listitem');
    expect(screen.queryByText(LATEST_NOTE)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: en.goals.detail.entries.loadMore }));
    expect(await screen.findByText(LATEST_NOTE)).toBeTruthy();
  });

  it('keeps an entry recorded while "load more" is in flight', async () => {
    stubApi({
      [GET_GOAL]: ok(goal()),
      [FIRST]: ok({ entries: entries(50) }),
      [SECOND]: ok({ entries: entries(70) }),
    });
    open();
    await screen.findAllByRole('listitem');
    fireEvent.click(screen.getByRole('button', { name: en.goals.detail.entries.loadMore }));
    fireEvent.click(screen.getByRole('button', { name: 'stub-record' }));

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(71);
    });
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0] as HTMLElement).getByText(money(20000n, 'ARS'))).toBeTruthy();
  });

  it('hides the control when fewer entries than asked came back (AC-11)', async () => {
    stubApi({ [GET_GOAL]: ok(goal()), [FIRST]: ok({ entries: entries(49) }) });
    open();
    await screen.findAllByRole('listitem');
    expect(screen.queryByRole('button', { name: en.goals.detail.entries.loadMore })).toBeNull();
  });

  it('hides the control once 100 entries are shown (AC-11)', async () => {
    stubApi({
      [GET_GOAL]: ok(goal()),
      [FIRST]: ok({ entries: entries(50) }),
      [SECOND]: ok({ entries: entries(100) }),
    });
    open();
    await screen.findAllByRole('listitem');
    await userEvent.click(screen.getByRole('button', { name: en.goals.detail.entries.loadMore }));
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(100);
    });
    expect(screen.queryByRole('button', { name: en.goals.detail.entries.loadMore })).toBeNull();
  });

  it('puts a recorded entry on top and follows the goal in the response with no request (AC-20, AC-23)', async () => {
    const { calls } = stubApi({
      [GET_GOAL]: ok(goal()),
      [FIRST]: ok({ entries: [entry(1)] }),
    });
    open();
    await screen.findAllByRole('listitem');
    expect(screen.getByTestId('goal-progress').textContent).toContain('progress:300000');
    const before = calls.length;

    await userEvent.click(screen.getByRole('button', { name: 'stub-record' }));

    await waitFor(() => {
      expect(screen.getByTestId('goal-progress').textContent).toContain('progress:320000');
    });
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText(money(20000n, 'ARS'))).toBeTruthy();
    expect(calls).toHaveLength(before);
  });

  it('shows a linked goal without history and with 1 request; an unlinked one makes 2 (NFR-02)', async () => {
    const linked = stubApi({ [GET_GOAL]: ok(goal({ accountId: ACCOUNT_ID })) });
    open();
    expect(await screen.findByText('linked-notice')).toBeTruthy();
    expect(screen.queryByText(en.goals.detail.entries.title)).toBeNull();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(linked.calls).toHaveLength(1);
  });

  it('makes 2 requests for an unlinked goal (NFR-02)', async () => {
    const { calls } = stubApi({ [GET_GOAL]: ok(goal()), [FIRST]: ok({ entries: [entry(1)] }) });
    open();
    await screen.findAllByRole('listitem');
    expect(calls).toHaveLength(2);
  });

  it('goes to the list after the goal is deleted', async () => {
    stubApi({ [GET_GOAL]: ok(goal()), [FIRST]: ok({ entries: [] }) });
    const { router } = open();
    await userEvent.click(await screen.findByRole('button', { name: 'stub-delete' }));
    expect(router.push).toHaveBeenCalledWith('/en/goals');
  });

  it('shows the error with a retry that loads again when the load fails (AC-07)', async () => {
    const { calls } = stubApi({
      [GET_GOAL]: [{ status: 500, body: { code: 'INTERNAL', message: 'x' } }, ok(goal())],
      [FIRST]: ok({ entries: [entry(1)] }),
    });
    open();
    const retry = await screen.findByRole('button', { name: en.app.retry });
    expect(screen.queryByText(en.goals.detail.notFound.title)).toBeNull();
    await userEvent.click(retry);
    await screen.findAllByRole('listitem');
    expect(calls.filter((call) => call.path === `/goals/${GOAL_ID}`)).toHaveLength(2);
  });

  it('keeps the shown entries and offers a retry when "load more" fails', async () => {
    stubApi({
      [GET_GOAL]: ok(goal()),
      [FIRST]: ok({ entries: entries(50) }),
      [SECOND]: [
        { status: 500, body: { code: 'INTERNAL', message: 'x' } },
        ok({ entries: entries(60) }),
      ],
    });
    open();
    await screen.findAllByRole('listitem');
    await userEvent.click(screen.getByRole('button', { name: en.goals.detail.entries.loadMore }));

    const alert = await screen.findByRole('alert');
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    await userEvent.click(within(alert).getByRole('button', { name: en.app.retry }));
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(60);
    });
  });

  it('shows the offline message and keeps the shown data when "load more" is offline (AC-28)', async () => {
    stubApi({
      [GET_GOAL]: ok(goal()),
      [FIRST]: ok({ entries: entries(50) }),
      [SECOND]: 'network-error',
    });
    open();
    await screen.findAllByRole('listitem');
    await userEvent.click(screen.getByRole('button', { name: en.goals.detail.entries.loadMore }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(en.errors.network)).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
  });

  it('shows the offline message when the first load is offline (AC-28)', async () => {
    stubApi({ [GET_GOAL]: 'network-error', [FIRST]: 'network-error' });
    open();
    expect(await screen.findByText(en.errors.network)).toBeTruthy();
  });

  it('renders Spanish strings, amounts and dates (AC-29)', async () => {
    stubApi({
      [GET_GOAL]: ok(goal()),
      [FIRST]: ok({ entries: [entry(1, { kind: 'withdrawal', amount: '5000' })] }),
    });
    open('es');
    const row = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
    expect(within(row).getByText(es.goals.detail.entries.withdrawal)).toBeTruthy();
    expect(within(row).getByText(money(5000n, 'ARS', 'es'))).toBeTruthy();
    expect(
      within(row).getByText(formatDateTime('2026-10-10T12:00:00.000Z', 'UTC', 'es')),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: es.goals.detail.edit })).toBeTruthy();
    // The shell's "‹ Goals" link goes back; the header carries no second one.
    expect(screen.queryByRole('link', { name: es.goals.detail.back })).toBeNull();
  });
});
