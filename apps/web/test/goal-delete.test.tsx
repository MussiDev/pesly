// @vitest-environment happy-dom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GoalDeleteAction } from '../src/features/goals/delete/goal-delete-action';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const GOAL_ID = '11111111-1111-4111-8111-111111111111';
const ROUTE = `DELETE /goals/${GOAL_ID}`;

function open(locale: 'en' | 'es' = 'en') {
  const onDeleted = vi.fn();
  renderApp(<GoalDeleteAction goalId={GOAL_ID} onDeleted={onDeleted} />, { locale });
  return onDeleted;
}

async function ask(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: en.goals.detail.delete }));
}

describe('GoalDeleteAction', () => {
  it('asks first, saying entries go and no balance changes (FR-11)', async () => {
    const { calls } = stubApi({});
    open();
    const user = userEvent.setup();

    expect(screen.queryByText(en.goals.delete.title)).toBeNull();
    await ask(user);

    expect(screen.getByText(en.goals.delete.title)).not.toBeNull();
    expect(screen.getByText(en.goals.delete.description)).not.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('confirming deletes once and calls onDeleted (AC-24)', async () => {
    const { calls } = stubApi({ [ROUTE]: { status: 204 } });
    const onDeleted = open();
    const user = userEvent.setup();

    await ask(user);
    await user.click(screen.getByRole('button', { name: en.goals.delete.confirm }));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledTimes(1);
    });
    expect(calls).toEqual([{ method: 'DELETE', path: `/goals/${GOAL_ID}`, body: undefined }]);
  });

  it('cancelling closes the confirmation and sends nothing (AC-25)', async () => {
    const { calls } = stubApi({});
    const onDeleted = open();
    const user = userEvent.setup();

    await ask(user);
    await user.click(screen.getByRole('button', { name: en.goals.delete.cancel }));

    expect(screen.queryByText(en.goals.delete.title)).toBeNull();
    expect(calls).toHaveLength(0);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('a goal that is not found shows the message and keeps the confirmation open', async () => {
    stubApi({ [ROUTE]: { status: 404, body: { code: 'NOT_FOUND' } } });
    const onDeleted = open();
    const user = userEvent.setup();

    await ask(user);
    await user.click(screen.getByRole('button', { name: en.goals.delete.confirm }));

    expect(await screen.findByText(en.goals.detail.notFound.description)).not.toBeNull();
    expect(screen.getByText(en.goals.delete.title)).not.toBeNull();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('a double tap sends one request', async () => {
    const { calls } = stubApi({ [ROUTE]: { status: 204 } });
    open();
    const user = userEvent.setup();

    await ask(user);
    const confirm = screen.getByRole('button', { name: en.goals.delete.confirm });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
  });

  it('a network failure shows the offline message and keeps the confirmation (AC-28)', async () => {
    stubApi({ [ROUTE]: 'network-error' });
    const onDeleted = open();
    const user = userEvent.setup();

    await ask(user);
    await user.click(screen.getByRole('button', { name: en.goals.delete.confirm }));

    expect(await screen.findByText(en.errors.network)).not.toBeNull();
    expect(screen.getByText(en.goals.delete.title)).not.toBeNull();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('controls have 44 px targets (NFR-06)', async () => {
    stubApi({});
    open();
    const user = userEvent.setup();

    await ask(user);
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('min-h-11');
    }
  });

  it('renders Spanish strings (AC-29)', async () => {
    stubApi({});
    open('es');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: es.goals.detail.delete }));
    expect(screen.getByText(es.goals.delete.description)).not.toBeNull();
  });
});
