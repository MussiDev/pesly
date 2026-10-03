// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  VerifyEmailNotice,
  VerifyEmailStatus,
} from '../src/features/auth/components/verify-email-notice';
import { CATALOGS, renderApp } from './support/render-app';

const { es, en } = CATALOGS;

function isDisabled(name: string): boolean {
  return screen.getByRole('button', { name }).hasAttribute('disabled');
}

describe('VerifyEmailNotice', () => {
  it('resends on click', async () => {
    const onResend = vi.fn();
    renderApp(<VerifyEmailNotice resendStatus="idle" errors={{}} onResend={onResend} />);

    expect(screen.getByRole('heading', { name: es.auth.checkYourEmail.title })).toBeDefined();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: es.auth.checkYourEmail.resend }));
    expect(onResend).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('is disabled while sending', () => {
    renderApp(<VerifyEmailNotice resendStatus="pending" errors={{}} onResend={vi.fn()} />);

    expect(isDisabled(es.auth.checkYourEmail.resending)).toBe(true);
  });

  it('confirms a sent email and shows form errors', () => {
    renderApp(
      <VerifyEmailNotice resendStatus="sent" errors={{ form: 'retryLater' }} onResend={vi.fn()} />,
    );

    expect(screen.getByRole('status').textContent).toBe(es.auth.checkYourEmail.resent);
    expect(screen.getByText(es.errors.retryLater)).toBeDefined();
  });
});

describe('VerifyEmailStatus', () => {
  it('announces the verification in progress without offering a resend', () => {
    renderApp(
      <VerifyEmailStatus status="verifying" resendStatus="idle" errors={{}} onResend={vi.fn()} />,
    );

    expect(screen.getByRole('status').textContent).toBe(es.auth.verifyEmail.verifying);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('continues into the app once verified', () => {
    renderApp(
      <VerifyEmailStatus status="verified" resendStatus="idle" errors={{}} onResend={vi.fn()} />,
      { locale: 'en' },
    );

    expect(screen.getByRole('heading', { name: en.auth.verifyEmail.verifiedTitle })).toBeDefined();
    expect(
      screen.getByRole('link', { name: en.auth.verifyEmail.continue }).getAttribute('href'),
    ).toBe('/en');
  });

  it('offers a new link after a failure, pending and sent', async () => {
    const onResend = vi.fn();
    const { rerender } = renderApp(
      <VerifyEmailStatus
        status="failed"
        resendStatus="idle"
        errors={{ form: 'tokenInvalid' }}
        onResend={onResend}
      />,
    );

    expect(screen.getByText(es.errors.tokenInvalid)).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: es.auth.verifyEmail.resend }));
    expect(onResend).toHaveBeenCalledOnce();

    rerender(
      <VerifyEmailStatus status="failed" resendStatus="pending" errors={{}} onResend={onResend} />,
    );
    expect(isDisabled(es.auth.verifyEmail.resending)).toBe(true);

    rerender(
      <VerifyEmailStatus status="failed" resendStatus="sent" errors={{}} onResend={onResend} />,
    );
    expect(screen.getByRole('status').textContent).toBe(es.auth.verifyEmail.resent);
  });
});
