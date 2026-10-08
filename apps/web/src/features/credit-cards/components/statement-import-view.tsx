'use client';

import type { StatementImportResponse } from '@pesly/shared';
import { CircleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { MovementField } from '@/features/movements/components/movement-field';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/format-amount';
import { formatCalendarDate } from '../format-dates';
import { reconcile, selectedLines } from '../statement-import/import-request';
import type { ParsedStatement, ParsedStatementLine } from '../statement-import/statement-types';

/** A full catalog path, plus the wait in seconds for the write limit message. */
export interface StatementImportAlert {
  path: string;
  seconds?: number;
}

export interface StatementImportCategoryOption {
  id: string;
  label: string;
}

export interface StatementImportViewProps {
  cardId: string;
  accept: string;
  categories: readonly StatementImportCategoryOption[];
  /** Catalog path of why the chosen file could not be read, if it could not. */
  fileError: string | undefined;
  parsing: boolean;
  statement: ParsedStatement | undefined;
  includeFees: boolean;
  categoryId: string;
  categoryError: boolean;
  pending: boolean;
  tooMany: boolean;
  alert: StatementImportAlert | undefined;
  result: StatementImportResponse | undefined;
  onFile: (file: File | undefined) => void;
  onIncludeFees: (include: boolean) => void;
  onCategory: (categoryId: string) => void;
  onImport: () => void;
}

function statusKey(line: ParsedStatementLine, chosen: boolean): string {
  if (chosen) return line.kind;
  return line.kind === 'fee' ? 'skippedFee' : 'ignored';
}

/** Presentational: the file picker, the preview of the parsed lines and the import summary. */
export function StatementImportView(props: StatementImportViewProps) {
  const t = useTranslations('creditCards.import');
  const { statement, result } = props;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle as="h1">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <MovementField label={t('file.label')} hint={t('file.hint')} error={props.fileError}>
            {(control) => (
              <Input
                type="file"
                accept={props.accept}
                disabled={props.pending || result !== undefined}
                onChange={(event) => {
                  props.onFile(event.currentTarget.files?.[0]);
                }}
                {...control}
              />
            )}
          </MovementField>
          {props.parsing ? (
            <p role="status" className="text-small text-muted-foreground">
              {t('parsing')}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {statement && result === undefined ? <Preview {...props} statement={statement} /> : null}

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2">{t('result.title')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p role="status">
              {t('result.summary', { created: result.created, skipped: result.skipped })}
            </p>
            <p className="text-small text-muted-foreground">
              {t('result.detail', {
                expenses: result.createdExpenses,
                purchases: result.createdInstallmentPurchases,
              })}
            </p>
            <Link
              href={`/cards/${props.cardId}`}
              className={buttonVariants({ variant: 'default' })}
            >
              {t('result.viewCard')}
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <Link href={`/cards/${props.cardId}`} className={buttonVariants({ variant: 'ghost' })}>
        {t('back')}
      </Link>
    </div>
  );
}

function Preview({
  statement,
  ...props
}: StatementImportViewProps & { statement: ParsedStatement }) {
  const t = useTranslations('creditCards.import');
  const tAll = useTranslations();
  const locale: Locale = useLocale() === 'en' ? 'en' : 'es';
  const chosen = new Set(selectedLines(statement, props.includeFees));
  const checks = reconcile(statement, props.includeFees);
  const differs = checks.some((check) => !check.matches);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('preview.title')}</CardTitle>
        <CardDescription>
          {t('preview.dates', {
            closing: formatCalendarDate(statement.closingDate, locale),
            due: formatCalendarDate(statement.dueDate, locale),
          })}
          {statement.cardEnding
            ? ` · ${t('preview.ending', { digits: statement.cardEnding })}`
            : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.alert ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>
              {tAll(props.alert.path, { seconds: props.alert.seconds ?? 0 })}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-small">
            <caption className="sr-only">{t('preview.caption')}</caption>
            <thead className="text-left text-muted-foreground">
              <tr>
                <th scope="col" className="p-2">
                  {t('preview.date')}
                </th>
                <th scope="col" className="p-2">
                  {t('preview.descriptionColumn')}
                </th>
                <th scope="col" className="p-2">
                  {t('preview.installments')}
                </th>
                <th scope="col" className="p-2 text-right">
                  {t('preview.amount')}
                </th>
                <th scope="col" className="p-2">
                  {t('preview.status')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {statement.lines.map((line, index) => (
                <tr key={`${line.date}-${String(index)}`}>
                  <td className="p-2 whitespace-nowrap">{formatCalendarDate(line.date, locale)}</td>
                  <td className="p-2">{line.description}</td>
                  <td className="p-2 whitespace-nowrap tabular-nums">
                    {line.installmentCount === null
                      ? ''
                      : t('preview.installmentOf', {
                          number: line.installmentNumber ?? 0,
                          count: line.installmentCount,
                        })}
                  </td>
                  <td className="p-2 text-right whitespace-nowrap tabular-nums">
                    {formatMoney(BigInt(line.amount), line.currency, locale)}
                  </td>
                  <td className="p-2">
                    <Badge variant={chosen.has(line) ? 'success' : 'outline'}>
                      {t(`status.${statusKey(line, chosen.has(line))}`)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3">
          <Checkbox
            id="include-fees"
            checked={props.includeFees}
            onChange={(event) => {
              props.onIncludeFees(event.currentTarget.checked);
            }}
          />
          <Label htmlFor="include-fees">{t('includeFees')}</Label>
        </div>

        <div className="grid gap-2" aria-live="polite">
          {checks.map((check) => (
            <p key={check.currency} className="text-small tabular-nums">
              {check.total === null
                ? t('reconcile.noTotal', {
                    sum: formatMoney(check.sum, check.currency, locale),
                  })
                : t('reconcile.line', {
                    sum: formatMoney(check.sum, check.currency, locale),
                    total: formatMoney(check.total, check.currency, locale),
                  })}
            </p>
          ))}
          {differs ? (
            <Alert>
              <CircleAlert aria-hidden />
              <AlertDescription>{t('reconcile.differs')}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <MovementField
          label={t('category.label')}
          error={props.categoryError ? 'creditCards.import.category.required' : undefined}
        >
          {(control) => (
            <Select
              value={props.categoryId}
              onChange={(event) => {
                props.onCategory(event.currentTarget.value);
              }}
              {...control}
            >
              <option value="">{t('category.placeholder')}</option>
              {props.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </Select>
          )}
        </MovementField>

        {props.tooMany ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{t('tooMany')}</AlertDescription>
          </Alert>
        ) : null}

        <Button
          disabled={props.pending || props.tooMany || chosen.size === 0}
          onClick={props.onImport}
        >
          {props.pending ? t('importing') : t('submit', { count: chosen.size })}
        </Button>
      </CardContent>
    </Card>
  );
}
