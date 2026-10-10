'use client';

import type { CreditCardResponse } from '@pesly/shared';
import { ChevronRight, CreditCard } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { Link } from '@/i18n/navigation';

/** The cards with their default days; each row opens the card page. */
export function CreditCardList({ cards }: { cards: readonly CreditCardResponse[] }) {
  const t = useTranslations('creditCards');

  const newCard = (
    <Link href="/cards/new" className={buttonVariants({ size: 'sm' })}>
      {t('new')}
    </Link>
  );

  if (cards.length === 0) {
    return (
      <EmptyState
        icon={<CreditCard aria-hidden="true" />}
        title={t('list.emptyTitle')}
        description={t('list.emptyDescription')}
        action={newCard}
      />
    );
  }

  return (
    <section className="grid gap-3" aria-label={t('list.label')}>
      <div className="flex justify-end">{newCard}</div>
      <ul className="divide-y rounded-xl border bg-card px-3">
        {cards.map((card) => (
          <li key={card.id} aria-label={card.name}>
            <Link href={`/cards/${card.id}`} className="block rounded-md focus-visible:outline-2">
              <ListRow
                interactive
                leading={<CreditCard aria-hidden="true" className="size-5 text-muted-foreground" />}
                title={card.name}
                description={t('list.days', { closing: card.closingDay, due: card.dueDay })}
                trailing={
                  <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
                }
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
