// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ExpenseOptionsResponse } from '@pesly/shared';
import { describe, expect, it, vi } from 'vitest';
import { buildRecentExpenseItems } from '../src/features/groups/detail/recent-expense-items';
import { useRecentExpenses } from '../src/features/groups/detail/use-recent-expenses';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en } = CATALOGS;
const GROUP_ID = '55555555-5555-4555-8555-555555555555';
const ME = '77777777-7777-4777-8777-777777777771';
const ANA = '77777777-7777-4777-8777-777777777772';
const FOOD = '66666666-6666-4666-8666-666666666661';
const UNKNOWN = '66666666-6666-4666-8666-666666666699';
const LIST = `GET /groups/${GROUP_ID}/expenses?limit=5`;
const OPTIONS = `GET /groups/${GROUP_ID}/expense-options`;

const options: ExpenseOptionsResponse = {
  selfMemberId: ME,
  members: [
    { id: ME, displayName: 'Joaquin', isGhost: false, joinedAt: '2026-10-01T00:00:00.000Z' },
    { id: ANA, displayName: 'Ana', isGhost: false, joinedAt: '2026-10-01T00:00:00.000Z' },
  ],
  categories: [
    {
      id: FOOD,
      defaultKey: null,
      name: 'Groceries',
      icon: 'utensils',
      color: 'orange',
      archivedAt: null,
    },
  ],
  defaultSplit: { mode: 'equal' },
  defaultRateType: 'blue',
};

const expense = (n: number, categoryId = FOOD) => ({
  id: `88888888-8888-4888-8888-88888888${String(n).padStart(4, '0')}`,
  groupId: GROUP_ID,
  payerMemberId: ANA,
  createdByMemberId: ANA,
  amount: '1500050',
  currency: 'ARS' as const,
  occurredAt: '2026-10-05T15:30:00.000Z',
  categoryId,
  description: `Expense ${n}`,
  splitMode: 'equal' as const,
  payerMovementId: null,
  createdAt: '2026-10-05T15:30:00.000Z',
  shares: [
    { memberId: ME, amount: '750025' },
    { memberId: ANA, amount: '750025' },
  ],
  version: 1,
});

function Probe({ onFatal }: { onFatal: (code: string) => void }) {
  const { state, retry } = useRecentExpenses(GROUP_ID, onFatal);
  return (
    <div>
      <p data-testid="state">
        {state.kind === 'ready' ? `ready:${String(state.expenses.length)}` : state.kind}
      </p>
      <button
        onClick={() => {
          retry();
        }}
      >
        retry
      </button>
    </div>
  );
}

const stateText = () => screen.getByTestId('state').textContent;

describe('useRecentExpenses', () => {
  it('asks for the 5 newest expenses and the options once each', async () => {
    const { calls } = stubApi({
      [LIST]: { status: 200, body: { items: [expense(1), expense(2)], nextCursor: null } },
      [OPTIONS]: { status: 200, body: options },
    });
    renderApp(<Probe onFatal={vi.fn()} />, { locale: 'en' });

    await waitFor(() => {
      expect(stateText()).toBe('ready:2');
    });
    expect(calls.map((call) => `${call.method} ${call.path}`).sort()).toEqual(
      [LIST, OPTIONS].sort(),
    );
  });

  it('is ready with no items for a group without expenses', async () => {
    stubApi({
      [LIST]: { status: 200, body: { items: [], nextCursor: null } },
      [OPTIONS]: { status: 200, body: options },
    });
    renderApp(<Probe onFatal={vi.fn()} />, { locale: 'en' });

    await waitFor(() => {
      expect(stateText()).toBe('ready:0');
    });
  });

  it('fails when the list call errors, and retry loads it again', async () => {
    const { calls } = stubApi({
      [LIST]: [{ status: 500 }, { status: 200, body: { items: [expense(1)], nextCursor: null } }],
      [OPTIONS]: { status: 200, body: options },
    });
    renderApp(<Probe onFatal={vi.fn()} />, { locale: 'en' });
    await waitFor(() => {
      expect(stateText()).toBe('failed');
    });

    await userEvent.click(screen.getByRole('button', { name: 'retry' }));

    await waitFor(() => {
      expect(stateText()).toBe('ready:1');
    });
    expect(calls.filter((call) => call.path === LIST.slice(4))).toHaveLength(2);
  });

  it.each([
    [404, 'NOT_FOUND'],
    [401, 'UNAUTHENTICATED'],
  ])('reports a %i answer to onFatal and leaves no failed state', async (status, code) => {
    stubApi({
      [LIST]: { status, body: { code } },
      [OPTIONS]: { status: 200, body: options },
    });
    const onFatal = vi.fn();
    renderApp(<Probe onFatal={onFatal} />, { locale: 'en' });

    await waitFor(() => {
      expect(onFatal).toHaveBeenCalledWith(code);
    });
    expect(stateText()).toBe('loading');
  });
});

describe('buildRecentExpenseItems', () => {
  const context = {
    language: 'en',
    timeZone: 'UTC',
    uncategorizedLabel: en.groups.expenses.uncategorized,
    unnamedLabel: en.groups.expenses.unnamedMember,
  } as const;

  it('maps category, payer, amount, date and own share, keeping the order it was given', () => {
    const items = buildRecentExpenseItems([expense(2), expense(1)], options, context);

    expect(items.map((item) => item.description)).toEqual(['Expense 2', 'Expense 1']);
    expect(items[0]).toMatchObject({
      payer: 'Ana',
      category: { label: 'Groceries', known: true },
      amount: expect.stringContaining('15,000.50') as string,
      share: expect.stringContaining('7,500.25') as string,
    });
    expect(items[0]?.date).toMatch(/^Oct \d/);
  });

  it('falls back to the uncategorized display, with no error, when the category is not listed', () => {
    const [item] = buildRecentExpenseItems([expense(1, UNKNOWN)], options, context);

    expect(item?.category).toMatchObject({
      known: false,
      label: en.groups.expenses.uncategorized,
    });
  });

  it('leaves the share out when the viewer holds none, and names an unknown payer', () => {
    const stranger = { ...expense(1), payerMemberId: '77777777-7777-4777-8777-777777777799' };
    const noShare = { ...stranger, shares: [{ memberId: ANA, amount: '1500050' }] };
    const [item] = buildRecentExpenseItems([noShare], options, context);

    expect(item?.share).toBeUndefined();
    expect(item?.payer).toBe(en.groups.expenses.unnamedMember);
  });
});
