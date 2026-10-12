// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Navigation from '../src/i18n/navigation';
import en from '../messages/en.json';

const redirect = vi.hoisted(() => vi.fn());
vi.mock('../src/i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof Navigation>()),
  redirect,
}));

import ReportsLayout from '../src/app/[locale]/(app)/reports/layout';
import ReportsIndexPage from '../src/app/[locale]/(app)/reports/page';

afterEach(cleanup);

describe('reports routes', () => {
  it('the index page redirects /reports to /reports/categories (AC-01)', async () => {
    await ReportsIndexPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(redirect).toHaveBeenCalledWith({ href: '/reports/categories', locale: 'en' });
  });

  it('the layout wraps the children with the title and the tab bar', () => {
    render(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
        <ReportsLayout>
          <p>child</p>
        </ReportsLayout>
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Report sections' })).toBeTruthy();
    expect(screen.getByText('child')).toBeTruthy();
  });
});
