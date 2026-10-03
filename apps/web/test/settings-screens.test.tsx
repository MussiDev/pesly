// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DeleteAccountPage from '../src/app/[locale]/(app)/settings/delete-account/page';
import ProfileSettingsPage from '../src/app/[locale]/(app)/settings/profile/page';
import SecuritySettingsPage from '../src/app/[locale]/(app)/settings/security/page';
import { CATALOGS, renderApp } from './support/render-app';

// The containers own data fetching and are tested on their own; the pages only frame them.
vi.mock('../src/features/profile/containers/profile-container', () => ({
  ProfileContainer: () => <section data-testid="container" />,
}));
vi.mock('../src/features/two-factor/containers/security-settings-container', () => ({
  SecuritySettingsContainer: () => <section data-testid="container" />,
}));
vi.mock('../src/features/profile/containers/delete-user-container', () => ({
  DeleteUserContainer: () => <section data-testid="container" />,
}));

const { es, en } = CATALOGS;

describe('settings screens (AC-16)', () => {
  it.each([
    ['profile', ProfileSettingsPage, es.profile.title, es.profile.subtitle],
    ['security', SecuritySettingsPage, es.security.title, es.security.subtitle],
    ['delete account', DeleteAccountPage, es.deleteUser.title, es.deleteUser.subtitle],
  ] as const)('%s opens with the page header and its container', (_name, Page, title, subtitle) => {
    renderApp(<Page />);

    const heading = screen.getByRole('heading', { level: 1, name: title });
    const header = heading.closest('[data-slot="page-header"]');
    expect(header).not.toBeNull();
    expect(header?.textContent).toContain(subtitle);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByTestId('container')).toBeDefined();
  });

  it('renders the English header copy in en', () => {
    renderApp(<SecuritySettingsPage />, { locale: 'en' });

    expect(screen.getByRole('heading', { level: 1, name: en.security.title })).toBeDefined();
    expect(screen.getByText(en.security.subtitle)).toBeDefined();
  });
});
