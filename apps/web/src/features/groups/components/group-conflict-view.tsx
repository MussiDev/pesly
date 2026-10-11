import type { GroupSplitMode } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface ConflictSplit {
  mode: GroupSplitMode;
  /** `value` is the share already formatted ("" for an equal split, which names members only). */
  rows: { member: string; value: string }[];
}

/** One version of the record, with every value already formatted for the person's locale. */
export interface ConflictSide {
  /** The local change deletes the record: there are no values to compare. */
  deleted?: boolean;
  amount: string;
  occurredAt: string;
  category?: string;
  description?: string;
  split?: ConflictSplit;
}

export interface GroupConflictViewProps {
  kind: 'expense' | 'settlement';
  mine: ConflictSide;
  server: ConflictSide;
  /** A resolution is running: both buttons wait. */
  busy: boolean;
  /** The last resolution was refused: both versions stay and the error shows. */
  failed: boolean;
  onKeepMine: () => void;
  onKeepServer: () => void;
}

type FieldName = 'amount' | 'date' | 'category' | 'description' | 'split';

interface Field {
  name: FieldName;
  value: (side: ConflictSide) => string;
}

const splitText = (side: ConflictSide): string =>
  side.split === undefined
    ? ''
    : `${side.split.mode}|${side.split.rows
        .map((row) => `${row.member}=${row.value}`)
        .sort()
        .join(',')}`;

const SETTLEMENT_FIELDS: Field[] = [
  { name: 'amount', value: (side) => side.amount },
  { name: 'date', value: (side) => side.occurredAt },
];

const EXPENSE_FIELDS: Field[] = [
  ...SETTLEMENT_FIELDS,
  { name: 'category', value: (side) => side.category ?? '' },
  { name: 'description', value: (side) => side.description ?? '' },
  { name: 'split', value: splitText },
];

function SplitList({ split }: { split: ConflictSplit }) {
  const t = useTranslations('groupConflict.splitModes');
  return (
    <>
      <span>{t(split.mode)}</span>
      <ul className="mt-1 space-y-0.5">
        {split.rows.map((row) => (
          <li key={row.member}>{row.value === '' ? row.member : `${row.member} · ${row.value}`}</li>
        ))}
      </ul>
    </>
  );
}

function Column({
  title,
  side,
  other,
  fields,
}: {
  title: string;
  side: ConflictSide;
  other: ConflictSide;
  fields: Field[];
}) {
  const t = useTranslations('groupConflict');
  const headingId = useId();
  let body: ReactNode;
  if (side.deleted === true) {
    body = <p className="text-body text-muted-foreground">{t('deleted')}</p>;
  } else {
    body = (
      <dl className="space-y-3">
        {fields.map((field) => {
          const differs = other.deleted === true || field.value(side) !== field.value(other);
          return (
            <div key={field.name}>
              <dt className="text-small text-muted-foreground">{t(`fields.${field.name}`)}</dt>
              <dd
                data-differs={differs ? 'true' : undefined}
                className={cn(
                  'rounded-md px-2 py-1 text-body text-foreground',
                  differs && 'bg-warning/15 font-medium',
                )}
              >
                {field.name === 'split' && side.split !== undefined ? (
                  <SplitList split={side.split} />
                ) : (
                  field.value(side)
                )}
                {differs ? <span className="sr-only"> {t('differs')}</span> : null}
              </dd>
            </div>
          );
        })}
      </dl>
    );
  }
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <Card>
        <CardContent className="space-y-3">
          <h3 id={headingId} className="text-body font-semibold text-foreground">
            {title}
          </h3>
          {body}
        </CardContent>
      </Card>
    </section>
  );
}

/** Both versions of a record that two people changed, side by side, and the choice between them (no merge). */
export function GroupConflictView({
  kind,
  mine,
  server,
  busy,
  failed,
  onKeepMine,
  onKeepServer,
}: GroupConflictViewProps) {
  const t = useTranslations('groupConflict');
  const fields = kind === 'expense' ? EXPENSE_FIELDS : SETTLEMENT_FIELDS;
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-heading font-semibold text-foreground">
          {t(kind === 'expense' ? 'titleExpense' : 'titleSettlement')}
        </h2>
        <p className="text-small text-muted-foreground">{t('description')}</p>
      </div>
      {failed ? (
        <Alert variant="destructive">
          <AlertDescription>{t('error')}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Column title={t('mine')} side={mine} other={server} fields={fields} />
        <Column title={t('server')} side={server} other={mine} fields={fields} />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="flex-1" disabled={busy} onClick={onKeepMine}>
          {t('keepMine')}
        </Button>
        <Button className="flex-1" variant="outline" disabled={busy} onClick={onKeepServer}>
          {t('keepServer')}
        </Button>
      </div>
    </div>
  );
}
