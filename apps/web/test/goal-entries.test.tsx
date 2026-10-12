// @vitest-environment happy-dom
import type { GoalResponse, RecordGoalEntryResponse } from '@pesly/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GoalEntryActions } from '../src/features/goals/entries/goal-entry-actions';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const GOAL_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const ENTRY_ID = '33333333-3333-4333-8333-333333333333';
const ROUTE = `POST /goals/${GOAL_ID}/entries`;

const goal = (overrides: Partial<GoalResponse> = {}): GoalResponse => ({
  id: GOAL_ID,
  name: 'Trip',
  targetAmount: '100000',
  currency: 'ARS',
  targetDate: null,
  accountId: null,
  progress: '50000',
  percentage: 50,
  status: 'active',
  monthlyAmountNeeded: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

const recorded = (
  kind: 'contribution' | 'withdrawal',
  amount: string,
): RecordGoalEntryResponse => ({
  entry: { id: ENTRY_ID, kind, amount, createdAt: '2026-10-11T00:00:00.000Z' },
  goal: goal({ progress: '70000', percentage: 70 }),
});

function open(
  g: GoalResponse = goal(),
  locale: 'en' | 'es' = 'en',
  onRecorded: (response: RecordGoalEntryResponse) => void = vi.fn(),
) {
  renderApp(<GoalEntryActions goal={g} onRecorded={onRecorded} />, { locale });
  return onRecorded;
}

function amountField(index: number): HTMLInputElement {
  const field = screen.getAllByLabelText<HTMLInputElement>(en.goals.entries.amount)[index];
  if (!field) throw new Error('missing amount field');
  return field;
}

describe('GoalEntryActions', () => {
  it('records a contribution of 200.00 once and hands the response to onRecorded (AC-20, AC-23)', async () => {
    const response = recorded('contribution', '20000');
    const { calls } = stubApi({ [ROUTE]: { status: 201, body: response } });
    const onRecorded = open();
    const user = userEvent.setup();

    const amount = amountField(0);
    await user.type(amount, '200.00');
    await user.click(screen.getByRole('button', { name: en.goals.entries.submitContribution }));

    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalledWith(response);
    });
    expect(calls).toEqual([
      {
        method: 'POST',
        path: `/goals/${GOAL_ID}/entries`,
        body: { kind: 'contribution', amount: '20000' },
      },
    ]);
    expect((screen.getAllByLabelText(en.goals.entries.amount)[0] as HTMLInputElement).value).toBe(
      '',
    );
  });

  it('records a withdrawal with its own kind', async () => {
    const { calls } = stubApi({ [ROUTE]: { status: 201, body: recorded('withdrawal', '1000') } });
    open();
    const user = userEvent.setup();

    await user.type(amountField(1), '10');
    await user.click(screen.getByRole('button', { name: en.goals.entries.submitWithdrawal }));

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.body).toEqual({ kind: 'withdrawal', amount: '1000' });
  });

  it.each(['', '0', 'abc'])(
    'shows a field error and sends nothing for "%s" (AC-21)',
    async (text) => {
      const { calls } = stubApi({});
      const onRecorded = open();
      const user = userEvent.setup();

      if (text !== '') await user.type(amountField(0), text);
      await user.click(screen.getByRole('button', { name: en.goals.entries.submitContribution }));

      expect(await screen.findByText(en.goals.entries.errors.amountInvalid)).not.toBeNull();
      expect(
        screen.getAllByLabelText(en.goals.entries.amount)[0]?.getAttribute('aria-invalid'),
      ).toBe('true');
      expect(calls).toHaveLength(0);
      expect(onRecorded).not.toHaveBeenCalled();
    },
  );

  it('a linked goal shows no forms and the notice (AC-22)', () => {
    stubApi({});
    open(goal({ accountId: ACCOUNT_ID }));

    expect(screen.getByText(en.goals.detail.linkedNotice)).not.toBeNull();
    expect(screen.queryByLabelText(en.goals.entries.amount)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a refused withdrawal shows the message and keeps the amount (AC-26)', async () => {
    stubApi({ [ROUTE]: { status: 409, body: { code: 'GOAL_WITHDRAWAL_EXCEEDS_PROGRESS' } } });
    const onRecorded = open();
    const user = userEvent.setup();

    const amount = amountField(1);
    await user.type(amount, '900');
    await user.click(screen.getByRole('button', { name: en.goals.entries.submitWithdrawal }));

    expect(await screen.findByText(en.errors.goalWithdrawalExceedsProgress)).not.toBeNull();
    expect(amount.value).toBe('900');
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('a network failure shows the offline message and keeps the amount (AC-28)', async () => {
    stubApi({ [ROUTE]: 'network-error' });
    open();
    const user = userEvent.setup();

    const amount = amountField(0);
    await user.type(amount, '5');
    await user.click(screen.getByRole('button', { name: en.goals.entries.submitContribution }));

    expect(await screen.findByText(en.errors.network)).not.toBeNull();
    expect(amount.value).toBe('5');
  });

  it('disables the submit while pending and sends one request on a double tap', async () => {
    const { calls } = stubApi({ [ROUTE]: { status: 201, body: recorded('contribution', '500') } });
    open();
    const user = userEvent.setup();

    await user.type(amountField(0), '5');
    const submit = screen.getByRole('button', { name: en.goals.entries.submitContribution });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
  });

  it('controls have labels and 44 px targets (NFR-06)', () => {
    stubApi({});
    open();

    for (const input of screen.getAllByLabelText(en.goals.entries.amount)) {
      expect(input.tagName).toBe('INPUT');
    }
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('min-h-11');
    }
  });

  it('renders Spanish and English strings (AC-29)', () => {
    stubApi({});
    open(goal(), 'es');
    expect(screen.getByText(es.goals.entries.contributionTitle)).not.toBeNull();
    expect(screen.getByText(es.goals.entries.withdrawalTitle)).not.toBeNull();
    expect(screen.getByRole('button', { name: es.goals.entries.submitWithdrawal })).not.toBeNull();
  });
});
