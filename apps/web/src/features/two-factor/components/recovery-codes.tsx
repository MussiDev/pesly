'use client';

import { CircleCheck, Copy, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFocusHeading } from '../use-focus-heading';

export type CopyStatus = 'idle' | 'copied' | 'failed';

export interface RecoveryCodesProps {
  /** Focus the heading on mount: set when this view replaced another one. */
  focusHeading?: boolean;
  codes: readonly string[];
  copyStatus: CopyStatus;
  onCopy: () => void;
  /** The explicit "I saved them" step: the codes are never shown again afterwards (AC-02). */
  onDone: () => void;
}

/** The text file offered for download: a header line, a blank line, then one code per line. */
export function recoveryCodesFile(header: string, codes: readonly string[]): string {
  return `${header}\n\n${codes.join('\n')}\n`;
}

/** The 10 recovery codes, shown once right after 2FA is enabled. */
export function RecoveryCodes({
  focusHeading = false,
  codes,
  copyStatus,
  onCopy,
  onDone,
}: RecoveryCodesProps) {
  const t = useTranslations('security.recoveryCodes');
  const headingRef = useFocusHeading(focusHeading);
  const downloadHref = `data:text/plain;charset=utf-8,${encodeURIComponent(
    recoveryCodesFile(t('fileHeader'), codes),
  )}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" ref={headingRef} tabIndex={-1} className="outline-none">
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* Explicit role: preflight removes the bullets and Safari then drops the list semantics. */}
        <ol
          role="list"
          className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-3 font-mono text-small"
        >
          {codes.map((code) => (
            <li key={code} className="rounded-lg bg-card px-2 py-2 text-center select-all">
              {code}
            </li>
          ))}
        </ol>
        {copyStatus === 'copied' ? (
          <Alert variant="success" role="status">
            <CircleCheck aria-hidden />
            <AlertDescription>{t('copied')}</AlertDescription>
          </Alert>
        ) : null}
        {copyStatus === 'failed' ? (
          <Alert variant="destructive">
            <AlertDescription>{t('copyFailed')}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" onClick={onCopy}>
            <Copy aria-hidden />
            {t('copy')}
          </Button>
          <a
            href={downloadHref}
            download={t('fileName')}
            className={buttonVariants({ variant: 'outline' })}
          >
            <Download aria-hidden />
            {t('download')}
          </a>
        </div>
        <Button onClick={onDone}>{t('done')}</Button>
      </CardContent>
    </Card>
  );
}
