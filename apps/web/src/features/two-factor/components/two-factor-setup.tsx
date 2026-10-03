'use client';

import { useTranslations } from 'next-intl';
import type { SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AuthField } from '@/features/auth/components/auth-field';
import { FormAlert } from '@/features/auth/components/form-alert';
import type { FormErrors } from '@/features/auth/form-errors';
import { readField } from '@/features/auth/read-field';
import { useFocusFirstInvalid } from '@/features/auth/use-focus-first-invalid';
import { useFocusHeading } from '../use-focus-heading';

export interface TwoFactorSetupProps {
  /** Focus the heading on mount: set when this view replaced another one. */
  focusHeading?: boolean;
  /** The `otpauth://` URI rendered as an SVG data URL. */
  qrDataUrl: string;
  /** The same secret in base32, for typing it into the app. */
  secret: string;
  pending: boolean;
  errors: FormErrors;
  onSubmit: (code: string) => void;
  onCancel: () => void;
}

/** Enrollment: scan the QR code (or type the secret), then confirm one code from the app. */
export function TwoFactorSetup({
  focusHeading = false,
  qrDataUrl,
  secret,
  pending,
  errors,
  onSubmit,
  onCancel,
}: TwoFactorSetupProps) {
  const t = useTranslations('security.setup');
  const headingRef = useFocusHeading(focusHeading);
  const formRef = useFocusFirstInvalid(errors);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(readField(event.currentTarget, 'code'));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" ref={headingRef} tabIndex={-1} className="outline-none">
          {t('title')}
        </CardTitle>
        <CardDescription>{t('scan')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* The SVG carries its own light background and quiet zone, so it scans in dark mode too. */}
        {/* data-slot is a styling and test contract hook, like the ui components' slots. */}
        <div data-slot="qr-tile" className="mx-auto rounded-lg border p-2">
          <img
            src={qrDataUrl}
            alt={t('qrAlt')}
            width={192}
            height={192}
            className="size-48 rounded-md"
          />
        </div>
        <div className="grid gap-2 text-small">
          <p className="text-muted-foreground">{t('manual')}</p>
          <code className="rounded-md bg-muted px-3 py-2 font-mono break-all select-all">
            {secret}
          </code>
        </div>
        <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
          <FormAlert error={errors.form} />
          <AuthField
            label={t('code')}
            description={t('codeHint')}
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={16}
            required
            error={errors.fields?.code}
          />
          <Button type="submit" disabled={pending}>
            {pending ? t('pending') : t('submit')}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t('cancel')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
