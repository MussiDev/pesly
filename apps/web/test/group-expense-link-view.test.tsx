// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  LinkExpenseView,
  type LinkExpenseViewProps,
} from '../src/features/groups/expenses/link/link-expense-view';
import { buildLinkRequest } from '../src/features/groups/expenses/link/link-request';
import { CATALOGS, renderApp } from './support/render-app';

const { en, es } = CATALOGS;
const link = en.groups.expenses.link;
const ACCOUNT = '66666666-6666-4666-8666-666666666666';
const CATEGORY = '77777777-7777-4777-8777-777777777777';
const MOVEMENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const props = (overrides: Partial<LinkExpenseViewProps> = {}): LinkExpenseViewProps => ({
  summary: 'Supermarket · 40,000.00 ARS · Oct 10, 2026',
  way: 'create',
  onWayChange: vi.fn(),
  accounts: [{ id: ACCOUNT, name: 'Wallet ARS' }],
  categories: [{ id: CATEGORY, label: 'Food' }],
  accountId: '',
  categoryId: '',
  onAccountChange: vi.fn(),
  onCategoryChange: vi.fn(),
  candidates: {
    kind: 'ready',
    items: [{ id: MOVEMENT, title: 'Chango', detail: 'Wallet ARS · Oct 9' }],
  },
  movementId: '',
  onMovementChange: vi.fn(),
  onRetryCandidates: vi.fn(),
  fieldErrors: {},
  issue: undefined,
  pending: false,
  onSubmit: vi.fn(),
  ...overrides,
});

describe('LinkExpenseView', () => {
  it('renders from props alone and makes no request of its own (AC-27)', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    renderApp(<LinkExpenseView {...props()} />, { locale: 'en' });

    expect(screen.getByRole('heading', { name: link.title })).toBeTruthy();
    expect(screen.getByText('Supermarket · 40,000.00 ARS · Oct 10, 2026')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports the way that was chosen and the choices that were made', async () => {
    const onWayChange = vi.fn();
    const onAccountChange = vi.fn();
    renderApp(<LinkExpenseView {...props({ onWayChange, onAccountChange })} />, { locale: 'en' });

    await userEvent.selectOptions(
      screen.getByLabelText(en.groups.expenses.form.fields.account),
      ACCOUNT,
    );
    await userEvent.click(screen.getByRole('radio', { name: link.ways.adopt }));

    expect(onAccountChange).toHaveBeenCalledWith(ACCOUNT);
    expect(onWayChange).toHaveBeenCalledWith('adopt');
  });

  it('shows the three states of the candidates: loading, failed with a retry, and empty with the way back (AC-22)', async () => {
    const onRetryCandidates = vi.fn();
    const onWayChange = vi.fn();
    const { rerender } = renderApp(
      <LinkExpenseView {...props({ way: 'adopt', candidates: { kind: 'loading' } })} />,
      { locale: 'en' },
    );
    expect(screen.getByText(link.loadingCandidates)).toBeTruthy();

    rerender(
      <LinkExpenseView
        {...props({ way: 'adopt', candidates: { kind: 'failed' }, onRetryCandidates })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: link.retry }));
    expect(onRetryCandidates).toHaveBeenCalledTimes(1);

    rerender(
      <LinkExpenseView
        {...props({ way: 'adopt', candidates: { kind: 'ready', items: [] }, onWayChange })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: link.useCreate }));
    expect(onWayChange).toHaveBeenCalledWith('create');
  });

  it('marks the chosen movement and shows the asked field errors as text (AC-24)', () => {
    renderApp(
      <LinkExpenseView
        {...props({ way: 'adopt', movementId: MOVEMENT, fieldErrors: { movement: true } })}
      />,
      { locale: 'en' },
    );

    expect(screen.getByRole('radio', { name: /Chango/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(link.errors.movement)).toBeTruthy();
  });

  it('renders the Spanish texts (AC-26)', () => {
    renderApp(<LinkExpenseView {...props()} />, { locale: 'es' });

    expect(screen.getByRole('heading', { name: es.groups.expenses.link.title })).toBeTruthy();
    expect(screen.getByRole('button', { name: es.groups.expenses.link.submit })).toBeTruthy();
  });

  it('disables the submit button and says it is linking while the request is pending', () => {
    renderApp(<LinkExpenseView {...props({ pending: true })} />, { locale: 'en' });

    const button = screen.getByRole('button', { name: link.pending });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('buildLinkRequest', () => {
  it('builds the body of the way that shows and ignores the other (AC-01)', () => {
    const values = { accountId: ACCOUNT, categoryId: CATEGORY, movementId: MOVEMENT };

    expect(buildLinkRequest({ way: 'create', ...values }).request).toEqual({
      mode: 'create',
      accountId: ACCOUNT,
      categoryId: CATEGORY,
    });
    expect(buildLinkRequest({ way: 'adopt', ...values }).request).toEqual({
      mode: 'adopt',
      movementId: MOVEMENT,
    });
  });

  it('asks for what is empty and builds no body (invalid input)', () => {
    expect(
      buildLinkRequest({ way: 'create', accountId: '', categoryId: '', movementId: '' }),
    ).toEqual({ fields: { account: true, category: true } });
    expect(
      buildLinkRequest({ way: 'adopt', accountId: ACCOUNT, categoryId: CATEGORY, movementId: '' }),
    ).toEqual({ fields: { movement: true } });
  });

  it('refuses an id that is not a uuid as invalid, with no body', () => {
    const result = buildLinkRequest({
      way: 'adopt',
      accountId: '',
      categoryId: '',
      movementId: 'not-a-uuid',
    });

    expect(result.request).toBeUndefined();
    expect(Object.keys(result.fields).length).toBeGreaterThan(0);
  });
});
