// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeleteUserForm } from '../src/features/profile/components/delete-user-form';
import { DeleteUserGoogle } from '../src/features/profile/components/delete-user-google';
import { CATALOGS, renderApp } from './support/render-app';

const { es, en } = CATALOGS;

function renderForm(props: Partial<Parameters<typeof DeleteUserForm>[0]> = {}) {
  const onSubmit = vi.fn();
  renderApp(
    <DeleteUserForm
      requirePassword
      requireCode={false}
      pending={false}
      errors={{}}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit };
}

function renderGoogle(props: Partial<Parameters<typeof DeleteUserGoogle>[0]> = {}) {
  const onStart = vi.fn();
  renderApp(<DeleteUserGoogle pending={false} failed={false} onStart={onStart} {...props} />);
  return { onStart };
}

describe('DeleteUserForm', () => {
  it('warns that the deletion is permanent and shows only the password field (FR-01)', () => {
    renderForm();

    expect(screen.getByText(es.deleteUser.warning)).toBeDefined();
    const password = screen.getByLabelText<HTMLInputElement>(es.deleteUser.password);
    expect(password.type).toBe('password');
    expect(password.autocomplete).toBe('current-password');
    expect(screen.queryByLabelText(es.deleteUser.code)).toBeNull();
    expect(screen.getByRole('button', { name: es.deleteUser.submit })).toBeDefined();
  });

  it('sits in a destructive-toned card, apart from the other settings', () => {
    renderForm();

    const card = screen
      .getByRole('heading', { level: 2, name: es.deleteUser.warningTitle })
      .closest('[data-slot="card"]');
    expect(card?.className).toContain('border-destructive/40');
    expect(
      screen.getByRole('heading', { level: 2, name: es.deleteUser.warningTitle }).className,
    ).toContain('text-destructive');
  });

  it('marks the destructive title with an icon, so the tone is not colour alone', () => {
    renderForm();

    const title = screen.getByRole('heading', { level: 2, name: es.deleteUser.warningTitle });
    expect(title.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(title.textContent).toBe(es.deleteUser.warningTitle);
  });

  it('shows the code field when the second factor is on and no password for a Google account', () => {
    renderForm({ requirePassword: false, requireCode: true });

    expect(screen.queryByLabelText(es.deleteUser.password)).toBeNull();
    const code = screen.getByLabelText<HTMLInputElement>(es.deleteUser.code);
    expect(code.autocomplete).toBe('one-time-code');
  });

  it('shows neither field for a Google account without 2FA', () => {
    renderForm({ requirePassword: false, requireCode: false });

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByLabelText(es.deleteUser.password)).toBeNull();
    expect(screen.getByRole('button', { name: es.deleteUser.submit })).toBeDefined();
  });

  it('submits what was typed, untouched (the container validates)', async () => {
    const { onSubmit } = renderForm({ requireCode: true });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(es.deleteUser.password), 'pw');
    await user.type(screen.getByLabelText(es.deleteUser.code), ' 123456 ');
    await user.click(screen.getByRole('button', { name: es.deleteUser.submit }));

    expect(onSubmit).toHaveBeenCalledWith({ password: 'pw', code: ' 123456 ' });
  });

  it('shows the form error and the field errors, and marks the fields invalid (sad path)', () => {
    renderForm({
      requireCode: true,
      errors: {
        form: 'network',
        fields: { password: 'passwordRequired', code: 'secondFactorCodeFormat' },
      },
    });

    expect(screen.getByText(es.errors.network)).toBeDefined();
    expect(screen.getByText(es.errors.passwordRequired)).toBeDefined();
    expect(screen.getByText(es.errors.secondFactorCodeFormat)).toBeDefined();
    expect(screen.getByLabelText(es.deleteUser.password).getAttribute('aria-invalid')).toBe('true');
  });

  it('disables the button and says so while pending', () => {
    renderForm({ pending: true });

    const button = screen.getByRole('button', { name: es.deleteUser.pending });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: es.deleteUser.submit })).toBeNull();
  });

  it('renders the English copy in en', () => {
    renderApp(
      <DeleteUserForm
        requirePassword
        requireCode={false}
        pending={false}
        errors={{}}
        onSubmit={vi.fn()}
      />,
      { locale: 'en' },
    );

    expect(screen.getByLabelText(en.deleteUser.password)).toBeDefined();
    expect(screen.getByRole('button', { name: en.deleteUser.submit })).toBeDefined();
  });
});

describe('DeleteUserGoogle', () => {
  it('explains the step and starts the re-authentication on click (AC-06)', async () => {
    const { onStart } = renderGoogle();
    const user = userEvent.setup();

    expect(screen.getByText(es.deleteUser.google.description)).toBeDefined();
    await user.click(screen.getByRole('button', { name: es.deleteUser.google.continue }));

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('shows the failure of a refused Google confirmation above the button (AC-07, sad path)', () => {
    renderGoogle({ failed: true });

    expect(screen.getByText(es.deleteUser.google.failed)).toBeDefined();
    expect(screen.getByRole('button', { name: es.deleteUser.google.continue })).toBeDefined();
  });

  it('marks the Google step title with an icon too', () => {
    renderGoogle();

    const title = screen.getByRole('heading', { level: 2, name: es.deleteUser.warningTitle });
    expect(title.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(title.textContent).toBe(es.deleteUser.warningTitle);
  });

  it('sits in a destructive-toned card too', () => {
    renderGoogle();

    const card = screen
      .getByRole('heading', { level: 2, name: es.deleteUser.warningTitle })
      .closest('[data-slot="card"]');
    expect(card?.className).toContain('border-destructive/40');
  });

  it('shows an API error key, such as an expired confirmation (sad path)', () => {
    renderGoogle({ error: 'reauthenticationRequired' });

    expect(screen.getByText(es.errors.reauthenticationRequired)).toBeDefined();
  });

  it('shows nothing about failure by default', () => {
    renderGoogle();

    expect(screen.queryByText(es.deleteUser.google.failed)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('disables the button while pending', () => {
    renderGoogle({ pending: true });

    const button = screen.getByRole('button', { name: es.deleteUser.google.pending });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
