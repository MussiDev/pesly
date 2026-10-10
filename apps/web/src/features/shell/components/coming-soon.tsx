import { Construction } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';

/** A destination of the design that is not built yet: it keeps its place in the navigation. */
export function ComingSoon({ title }: { title: string }) {
  const t = useTranslations('app.comingSoon');

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 desk:p-8">
      <PageHeader title={title} />
      <section
        aria-labelledby="coming-soon-title"
        className="grid justify-items-center gap-3 rounded-card bg-card px-6 py-12 text-center"
      >
        <span
          aria-hidden
          className="flex size-12 items-center justify-center rounded-pill bg-accent text-accent-foreground"
        >
          <Construction className="size-6" />
        </span>
        <Badge variant="info">{t('badge')}</Badge>
        <h2 id="coming-soon-title" className="text-heading">
          {t('title')}
        </h2>
        <p className="max-w-sm text-small text-muted-foreground">{t('description')}</p>
      </section>
    </main>
  );
}
