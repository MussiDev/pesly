import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';

const TILES = ['spent', 'income', 'result'] as const;

/** The month's spending, income and result: the figures are not computed yet, the tiles keep their place. */
export function MonthSummary() {
  const t = useTranslations('home.month');

  return (
    <section aria-label={t('label')} className="grid gap-2">
      <ul className="grid grid-cols-3 gap-2 desk:gap-4">
        {TILES.map((tile) => (
          <li key={tile} className="grid min-w-0 gap-1 rounded-2xl bg-card p-3.5">
            <span className="text-caption text-muted-foreground">{t(tile)}</span>
            <span className="text-body font-bold text-muted-foreground desk:text-title">—</span>
          </li>
        ))}
      </ul>
      <Badge variant="info" className="justify-self-start">
        {t('inCreation')}
      </Badge>
    </section>
  );
}
