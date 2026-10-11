'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { ActivityRowView } from './activity-view';

export interface ActivityEntryData extends ActivityRowView {
  /** Already formatted in the user's time zone. */
  date: string;
}

/**
 * One log entry. Every name and value is plain text: React escapes it, and nothing here renders
 * markup or markdown.
 */
export function ActivityEntryRow({ entry }: { entry: ActivityEntryData }) {
  const t = useTranslations('groups.activity');
  const tFields = useTranslations('groups.activity.fields');

  return (
    <li className="grid gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-small break-words">
          <span className="font-semibold">{entry.memberName}</span>{' '}
          <span>{t(`actions.${entry.action}`)}</span>
        </span>
        <Badge variant="info">{t(`kinds.${entry.kind}`)}</Badge>
      </div>
      <span className="text-small text-muted-foreground">{entry.date}</span>
      {entry.details.length > 0 ? (
        <dl className="grid gap-1 text-small">
          {entry.details.map((detail) => (
            <div key={detail.field} className="grid gap-0.5">
              <dt className="text-muted-foreground">{tFields(detail.field)}</dt>
              <dd className="flex flex-wrap items-center gap-x-2 break-words">
                {detail.before !== null ? (
                  <span>
                    <span className="sr-only">{t('before')}: </span>
                    {detail.before}
                  </span>
                ) : null}
                {detail.before !== null && detail.after !== null ? (
                  <span aria-hidden="true">→</span>
                ) : null}
                {detail.after !== null ? (
                  <span>
                    <span className="sr-only">{t('after')}: </span>
                    {detail.after}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}
