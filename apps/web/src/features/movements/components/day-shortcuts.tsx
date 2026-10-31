'use client';

import { useTranslations } from 'next-intl';
import { Chip } from '@/components/ui/chip';

/** `YYYY-MM-DD` of the calendar day before `day`; pure calendar arithmetic, no time zone. */
export function previousDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date - 1)).toISOString().slice(0, 10);
}

interface DayShortcutsProps {
  /** Today's wall-clock instant in the user's zone, `YYYY-MM-DDTHH:mm`. */
  today: string;
  /** The field's current value, `YYYY-MM-DDTHH:mm`. */
  value: string;
  /** The new value: the chosen day with the field's time kept. */
  onPick: (value: string) => void;
}

/**
 * "Today" and "Yesterday" in one tap, before the date picker: most entries are recorded the day
 * they happen or the next. The time of day already in the field is kept.
 */
export function DayShortcuts({ today, value, onPick }: DayShortcutsProps) {
  const t = useTranslations('movements.form.dayShortcuts');
  const todayDay = today.slice(0, 10);
  const days = [
    { key: 'today', day: todayDay },
    { key: 'yesterday', day: previousDay(todayDay) },
  ] as const;
  const time = value.slice(11) || today.slice(11);

  return (
    <div role="group" aria-label={t('label')} className="flex flex-wrap gap-2">
      {days.map(({ key, day }) => (
        <Chip
          key={key}
          pressed={value.slice(0, 10) === day}
          onClick={() => {
            onPick(`${day}T${time}`);
          }}
        >
          {t(key)}
        </Chip>
      ))}
    </div>
  );
}
