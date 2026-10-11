'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * A link in a selectable read-only field, with a copy action (the field stays visible so a failed
 * copy can be done by hand) and a share action only where the browser has one.
 */
export function ShareLink({ link }: { link: string }) {
  const t = useTranslations('groups.invite');
  const [copy, setCopy] = useState<CopyState>('idle');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopy('copied');
    } catch {
      // The clipboard can be missing or denied; the link stays visible for a manual copy.
      setCopy('failed');
    }
  }

  async function shareLink() {
    try {
      await navigator.share({ title: t('shareTitle'), url: link });
    } catch {
      // Closing the share sheet rejects; the user chose not to share, nothing to report.
    }
  }

  return (
    <div className="grid gap-2">
      <Input
        readOnly
        value={link}
        aria-label={t('linkLabel')}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void copyLink();
          }}
        >
          {t('copy')}
        </Button>
        {canShare ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void shareLink();
            }}
          >
            {t('share')}
          </Button>
        ) : null}
      </div>
      <p role="status" className="text-small text-muted-foreground">
        {copy === 'copied' ? t('copied') : null}
        {copy === 'failed' ? t('copyFailed') : null}
      </p>
    </div>
  );
}
