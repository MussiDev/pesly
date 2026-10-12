'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import type { FirstStepsView } from '../dashboard-view';

const PRIMARY_LINK =
  'inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground focus-visible:outline-2';

interface Step {
  key: 'createAccount' | 'recordMovement';
  href: string;
  done: boolean;
}

/** The two-step guide for a user with no account or no movement yet (FR-15). */
export function FirstSteps({ firstSteps }: { firstSteps: FirstStepsView }) {
  const t = useTranslations('dashboard.firstSteps');
  const steps: Step[] = [
    { key: 'createAccount', href: '/accounts/new', done: firstSteps.hasAccount },
    { key: 'recordMovement', href: '/movements/new', done: firstSteps.hasMovement },
  ];

  // Only the first pending step is the primary action; a later one waits for it.
  const current = steps.find((step) => !step.done)?.key;

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3">
          {steps.map((step) => (
            <li key={step.key} className="flex min-h-11 items-center gap-3">
              {step.done ? (
                <>
                  <Check aria-hidden="true" className="size-5 shrink-0 text-success" />
                  <span>{t(step.key)}</span>
                  <span className="text-small font-semibold text-success">{t('done')}</span>
                </>
              ) : step.key !== current ? (
                <span>{t(step.key)}</span>
              ) : (
                <Link href={step.href} className={PRIMARY_LINK}>
                  {t(step.key)}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
