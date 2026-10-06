'use client';

import type { StatementResponse } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { formatCalendarDate, formatPeriod } from '../format-dates';
import { StatementDatesForm, type StatementDatesValues } from './statement-dates-form';

interface StatementListProps {
  statements: readonly StatementResponse[];
  editingId: string | undefined;
  pending: boolean;
  onEdit: (id: string) => void;
  onCancel: () => void;
  onSave: (id: string, values: StatementDatesValues) => void;
}

/** Newest first; only open statements can have their dates edited (FR-05, FR-07). */
export function StatementList({
  statements,
  editingId,
  pending,
  onEdit,
  onCancel,
  onSave,
}: StatementListProps) {
  const t = useTranslations('creditCards.detail');
  const locale = useLocale();

  return (
    <ul className="divide-y rounded-xl border bg-card px-3">
      {statements.map((statement) => {
        const label = formatPeriod(statement.period, locale);
        const open = statement.status === 'open';
        return (
          <li key={statement.id} aria-label={label}>
            <ListRow
              title={label}
              description={
                <>
                  <span>
                    {t('closes', { date: formatCalendarDate(statement.closingDate, locale) })}
                  </span>
                  <span aria-hidden="true"> · </span>
                  <span>{t('due', { date: formatCalendarDate(statement.dueDate, locale) })}</span>
                </>
              }
              trailing={
                <span className="flex items-center gap-2">
                  <Badge variant={open ? 'info' : 'default'}>
                    {open ? t('open') : t('closed')}
                  </Badge>
                  {open && editingId !== statement.id ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onEdit(statement.id);
                      }}
                    >
                      {t('edit')}
                    </Button>
                  ) : null}
                </span>
              }
            />
            {editingId === statement.id ? (
              <StatementDatesForm
                statement={statement}
                pending={pending}
                onCancel={onCancel}
                onSave={(values) => {
                  onSave(statement.id, values);
                }}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
