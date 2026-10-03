'use client';

import { CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

/** What was saved: the rate frozen on the movement (already formatted) and the way back to the list. */
export function MovementSaved({ rate }: { rate: string }) {
  const t = useTranslations('movements.saved');

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Alert variant="success" role="status">
          <CircleCheck aria-hidden />
          <AlertDescription>{t('rate', { rate })}</AlertDescription>
        </Alert>
        <Link href="/movements" className={buttonVariants({ variant: 'outline' })}>
          {t('back')}
        </Link>
      </CardContent>
    </Card>
  );
}
