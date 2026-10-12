// @vitest-environment happy-dom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BudgetDeleteAction } from '../src/features/budgets/delete/budget-delete-action';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const BUDGET_ID = '11111111-1111-4111-8111-111111111111';
const ROUTE = `DELETE /budgets/${BUDGET_ID}`;

function open(locale: 'en' | 'es' = 'en') {
  const onDeleted = vi.fn();
  renderApp(<BudgetDeleteAction budgetId={BUDGET_ID} onDeleted={onDeleted} />, { locale });
  return onDeleted;
}

async function ask(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: en.budgets.detail.delete }));
}

describe('BudgetDeleteAction', () => {
  it('asks first, saying past spending is not affected (FR-12)', async () => {
    const { calls } = stubApi({});
    open();
    const user = userEvent.setup();

    expect(screen.queryByText(en.budgets.delete.title)).toBeNull();
    await ask(user);

    expect(screen.getByText(en.budgets.delete.title)).not.toBeNull();
    expect(screen.getByText(en.budgets.delete.description)).not.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('confirming deletes once and calls onDeleted (AC-24, NFR-02)', async () => {
    const { calls } = stubApi({ [ROUTE]: { status: 204 } });
    const onDeleted = open();
    const user = userEvent.setup();

    await ask(user);
    await user.click(screen.getByRole('button', { name: en.budgets.delete.confirm }));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledTimes(1);
    });
    expect(calls).toEqual([{ method: 'DELETE', path: `/budgets/${BUDGET_ID}`, body: undefined }]);
  });

  it('cancelling closes the confirmation and sends nothing (AC-25)', async () => {
    const { calls } = stubApi({});
    const onDeleted = open();
    const user = userEvent.setup();

    await ask(user);
    await user.click(screen.getByRole('button', { name: en.budgets.delete.cancel }));

    expect(screen.queryByText(en.budgets.delete.title)).toBeNull();
    expect(calls).toHaveLength(0);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('a budget that is not found shows the message and keeps the confirmation open', async () => {
    stubApi({ [ROUTE]: { status: 404, body: { code: 'NOT_FOUND' } } });
    const onDeleted = open();
    const user = userEvent.setup();

    await ask(user);
    await user.click(screen.getByRole('button', { name: en.budgets.delete.confirm }));

    expect(await screen.findByText(en.budgets.detail.notFound.description)).not.toBeNull();
    expect(screen.getByText(en.budgets.delete.title)).not.toBeNull();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('a double tap sends one request', async () => {
    const { calls } = stubApi({ [ROUTE]: { status: 204 } });
    open();
    const user = userEvent.setup();

    await ask(user);
    const confirm = screen.getByRole('button', { name: en.budgets.delete.confirm });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
  });

  it('keeps the lock after a successful delete so a later tap sends nothing', async () => {
    const { calls } = stubApi({ [ROUTE]: { status: 204 } });
    const onDeleted = open();
    const user = userEvent.setup();

    await ask(user);
    const confirm = screen.getByRole('button', { name: en.budgets.delete.confirm });
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(confirm);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls).toHaveLength(1);
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('a network failure shows the offline message and keeps the confirmation (AC-29)', async () => {
    stubApi({ [ROUTE]: 'network-error' });
    const onDeleted = open();
    const user = userEvent.setup();

    await ask(user);
    await user.click(screen.getByRole('button', { name: en.budgets.delete.confirm }));

    expect(await screen.findByText(en.errors.network)).not.toBeNull();
    expect(screen.getByText(en.budgets.delete.title)).not.toBeNull();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('controls have labels and 44 px targets (NFR-06)', async () => {
    stubApi({});
    open();
    const user = userEvent.setup();

    await ask(user);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.className).toContain('min-h-11');
      expect(button.textContent.length).toBeGreaterThan(0);
    }
  });

  it('renders Spanish strings (AC-30)', async () => {
    stubApi({});
    open('es');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: es.budgets.detail.delete }));
    expect(screen.getByText(es.budgets.delete.description)).not.toBeNull();
  });
});
