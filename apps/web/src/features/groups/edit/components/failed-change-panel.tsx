import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { canRetry, rejectionMessagePath } from '../rejection';

interface FailedChangePanelProps {
  /** The short code kept with the rejected change; it only selects the message. */
  code: string;
  onRetry: () => void;
  onDiscard: () => void;
}

/** Why the server refused a queued change, with retry (when it can help) and discard (FR-09). */
export function FailedChangePanel({ code, onRetry, onDiscard }: FailedChangePanelProps) {
  const t = useTranslations('groups.edit.common');
  const tAll = useTranslations();
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertTitle>{t('failedPanel.title')}</AlertTitle>
      <AlertDescription>
        <p>{tAll(rejectionMessagePath(code))}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {canRetry(code) ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t('actions.retry')}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={onDiscard}>
            {t('actions.discard')}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
