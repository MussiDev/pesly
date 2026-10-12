import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { formatMonth } from '../format';

/** A month select with previous and next buttons; `months` is newest first and never in the future. */
export function MonthPicker({
  months,
  value,
  onChange,
}: {
  months: readonly string[];
  value: string;
  onChange: (month: string) => void;
}) {
  const t = useTranslations('groups.categoryViews.month');
  const language = useLocale() === 'en' ? 'en' : 'es';
  const index = months.indexOf(value);
  const older = index >= 0 ? months[index + 1] : undefined;
  const newer = index > 0 ? months[index - 1] : undefined;
  return (
    <div className="flex items-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('previous')}
        disabled={older === undefined}
        onClick={() => {
          if (older !== undefined) onChange(older);
        }}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <label className="grid min-w-0 flex-1 gap-1 text-small text-muted-foreground">
        <span>{t('label')}</span>
        <Select
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {months.map((month) => (
            <option key={month} value={month}>
              {formatMonth(month, language)}
            </option>
          ))}
        </Select>
      </label>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('next')}
        disabled={newer === undefined}
        onClick={() => {
          if (newer !== undefined) onChange(newer);
        }}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}
