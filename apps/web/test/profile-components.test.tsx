// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PreferencesForm } from '../src/features/profile/components/preferences-form';
import { ProfileLoadStateView } from '../src/features/profile/components/profile-load-state';
import { ProfileForm } from '../src/features/profile/components/profile-form';
import { CATALOGS, renderApp } from './support/render-app';

const { es, en } = CATALOGS;

const PREFERENCES = {
  defaultRateType: 'blue',
  displayCurrency: 'ARS',
  timeZone: 'America/Argentina/Buenos_Aires',
  language: 'es',
} as const;
const TIME_ZONES = ['America/Argentina/Buenos_Aires', 'Europe/Madrid'];

function renderProfileForm(props: Partial<Parameters<typeof ProfileForm>[0]> = {}) {
  const onSubmit = vi.fn();
  renderApp(
    <ProfileForm
      displayName="Ana"
      email="ana@example.com"
      twoFactorEnabled={false}
      pending={false}
      saved={false}
      errors={{}}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit };
}

function renderPreferencesForm(props: Partial<Parameters<typeof PreferencesForm>[0]> = {}) {
  const onSubmit = vi.fn();
  renderApp(
    <PreferencesForm
      preferences={PREFERENCES}
      timeZones={TIME_ZONES}
      pending={false}
      saved={false}
      errors={{}}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit };
}

describe('ProfileForm', () => {
  it('shows the name in a field, the email as text and the 2FA status (AC-01, FR-03)', () => {
    renderProfileForm({ twoFactorEnabled: true });

    expect(screen.getByLabelText<HTMLInputElement>(es.profile.account.displayName).value).toBe(
      'Ana',
    );
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByText('ana@example.com').tagName).not.toBe('INPUT');
    expect(screen.getByText(es.profile.account.twoFactorOn)).toBeDefined();
  });

  it('shows 2FA as not enabled and an empty field for a null name (AC-01)', () => {
    renderProfileForm({ displayName: null });

    expect(screen.getByLabelText<HTMLInputElement>(es.profile.account.displayName).value).toBe('');
    expect(screen.getByText(es.profile.account.twoFactorOff)).toBeDefined();
  });

  it('submits the typed name as it is, leaving validation to the container', async () => {
    const { onSubmit } = renderProfileForm();
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText(es.profile.account.displayName));
    await user.type(screen.getByLabelText(es.profile.account.displayName), ' Bea ');
    await user.click(screen.getByRole('button', { name: es.profile.account.submit }));

    expect(onSubmit).toHaveBeenCalledWith({ displayName: ' Bea ' });
  });

  it('shows a field error on the name, marks it invalid and moves focus to it (AC-03)', () => {
    renderProfileForm({ errors: { fields: { displayName: 'displayNameTooLong' } } });

    const field = screen.getByLabelText(es.profile.account.displayName);
    expect(screen.getByText(es.profile.errors.displayNameTooLong)).toBeDefined();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field);
  });

  it('shows a form error above the fields and disables the button while pending', () => {
    renderProfileForm({ errors: { form: 'validationFailed' }, pending: true });

    expect(screen.getByText(es.errors.validationFailed)).toBeDefined();
    const button = screen.getByRole<HTMLButtonElement>('button', {
      name: es.profile.account.pending,
    });
    expect(button.disabled).toBe(true);
  });

  it('confirms a save with a status message', () => {
    renderProfileForm({ saved: true });

    expect(screen.getByRole('status').textContent).toBe(es.profile.saved);
  });

  it('shows the saved notice with the success alert variant', () => {
    renderProfileForm({ saved: true });

    expect(screen.getByRole('status').className).toContain('border-success/40');
  });

  it('groups the form in a card and shows email and 2FA status as list rows with a badge', () => {
    renderProfileForm({ twoFactorEnabled: true });

    const card = screen
      .getByRole('heading', { level: 2, name: es.profile.account.title })
      .closest('[data-slot="card"]');
    expect(card).not.toBeNull();
    const rows = Array.from(card?.querySelectorAll('[data-slot="list-row"]') ?? []);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('ana@example.com');
    const badge = rows[1]?.querySelector('[data-slot="badge"]');
    expect(badge?.textContent).toBe(es.profile.account.twoFactorOn);
    expect(badge?.className).toContain('text-success');
  });

  it('shows 2FA off as a neutral badge', () => {
    renderProfileForm({ twoFactorEnabled: false });

    const badge = screen.getByText(es.profile.account.twoFactorOff).closest('[data-slot="badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.className).not.toContain('text-success');
  });

  it('shows a rejected save as an error alert above the fields (sad path)', () => {
    renderProfileForm({ errors: { form: 'network' } });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(es.errors.network);
    expect(alert.className).toContain('border-destructive/40');
  });
});

describe('PreferencesForm', () => {
  it('shows the saved preferences as the selected options (AC-05, AC-06, AC-07)', () => {
    renderPreferencesForm();

    const value = (label: string) => screen.getByLabelText<HTMLSelectElement>(label).value;
    expect(value(es.profile.preferences.defaultRateType)).toBe('blue');
    expect(value(es.profile.preferences.displayCurrency)).toBe('ARS');
    expect(value(es.profile.preferences.timeZone)).toBe('America/Argentina/Buenos_Aires');
    expect(value(es.profile.preferences.language)).toBe('es');
    expect(
      within(screen.getByLabelText(es.profile.preferences.timeZone))
        .getAllByRole('option')
        .map((option) => option.getAttribute('value')),
    ).toEqual(TIME_ZONES);
  });

  it('submits every select value, labelled from the catalog', async () => {
    const { onSubmit } = renderPreferencesForm();
    const user = userEvent.setup();

    await user.selectOptions(
      screen.getByLabelText(es.profile.preferences.defaultRateType),
      es.profile.rateTypes.ccl,
    );
    await user.selectOptions(
      screen.getByLabelText(es.profile.preferences.timeZone),
      'Europe/Madrid',
    );
    await user.selectOptions(screen.getByLabelText(es.profile.preferences.language), 'en');
    await user.click(screen.getByRole('button', { name: es.profile.preferences.submit }));

    expect(onSubmit).toHaveBeenCalledWith({
      defaultRateType: 'ccl',
      displayCurrency: 'ARS',
      timeZone: 'Europe/Madrid',
      language: 'en',
    });
  });

  it('shows the time zone field error and form error, and disables the button while pending', () => {
    renderPreferencesForm({
      errors: { form: 'network', fields: { timeZone: 'timeZoneInvalid' } },
      pending: true,
    });

    expect(screen.getByText(es.profile.errors.timeZoneInvalid)).toBeDefined();
    expect(screen.getByText(es.errors.network)).toBeDefined();
    expect(
      screen.getByLabelText(es.profile.preferences.timeZone).getAttribute('aria-invalid'),
    ).toBe('true');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: es.profile.preferences.pending })
        .disabled,
    ).toBe(true);
  });

  it('confirms a save with a status message in the current language', () => {
    renderApp(
      <PreferencesForm
        preferences={PREFERENCES}
        timeZones={TIME_ZONES}
        pending={false}
        saved
        errors={{}}
        onSubmit={vi.fn()}
      />,
      { locale: 'en' },
    );

    expect(screen.getByRole('status').textContent).toBe(en.profile.saved);
  });

  it('shows the saved notice with the success alert variant', () => {
    renderPreferencesForm({ saved: true });

    expect(screen.getByRole('status').className).toContain('border-success/40');
  });
});

describe('ProfileLoadStateView soft shapes (AC-35)', () => {
  it('draws one skeleton per card with the card radius', () => {
    const { container } = renderApp(
      <ProfileLoadStateView state={{ kind: 'loading' }} cards={2} onRetry={vi.fn()} />,
    );

    expect(container.querySelectorAll('[data-slot="skeleton"].rounded-card')).toHaveLength(2);
  });
});
