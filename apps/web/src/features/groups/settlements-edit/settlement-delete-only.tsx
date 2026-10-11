'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteConfirm } from '../edit/components/delete-confirm';

interface SettlementDeleteOnlyProps {
  confirming: boolean;
  pending: boolean;
  unavailable: boolean;
  onAskDelete: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A consolidated settlement has no fields (D10): it can only be deleted. */
export function SettlementDeleteOnly({
  confirming,
  pending,
  unavailable,
  onAskDelete,
  onConfirm,
  onCancel,
}: SettlementDeleteOnlyProps) {
  const t = useTranslations('groups.edit.settlement.deleteOnly');
  const tCommon = useTranslations('groups.edit.common');
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {unavailable ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{tCommon('unavailable')}</AlertDescription>
          </Alert>
        ) : null}
        {confirming ? (
          <DeleteConfirm pending={pending} onConfirm={onConfirm} onCancel={onCancel} />
        ) : (
          <div>
            <Button variant="outline" onClick={onAskDelete}>
              {tCommon('actions.delete')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
