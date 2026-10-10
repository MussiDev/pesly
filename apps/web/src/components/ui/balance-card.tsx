import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface BalanceCardProps {
  /** The accessible name of the group, e.g. the currency. */
  label: string;
  primaryLabel: string;
  primary: ReactNode;
  secondaryLabel: string;
  secondary: ReactNode;
  /** No surface of its own: it sits inside a shared navy block that holds several cards. */
  bare?: boolean;
}

/**
 * The one saturated surface of a screen: a headline figure over a gradient, with a smaller figure
 * in a pill below. Long figures wrap instead of overflowing, so a large balance never runs into
 * its neighbour or out of the card.
 */
export function BalanceCard({
  label,
  primaryLabel,
  primary,
  secondaryLabel,
  secondary,
  bare = false,
}: BalanceCardProps) {
  return (
    <div
      data-slot="balance-card"
      role="group"
      aria-label={label}
      className={cn(
        'relative min-w-0',
        bare
          ? 'text-hero-foreground'
          : 'overflow-hidden rounded-card bg-hero px-5 pt-4.5 pb-5 text-hero-foreground',
      )}
    >
      <dl className="relative grid gap-4">
        <div className="grid min-w-0 gap-1">
          <dt className="text-small text-hero-muted">{primaryLabel}</dt>
          <dd className="text-title break-words sm:text-display [&_[data-slot=amount]]:whitespace-normal">
            {primary}
          </dd>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-hero-foreground/20 pt-3">
          <dt className="text-small text-hero-muted">{secondaryLabel}</dt>
          <dd className="text-small font-semibold break-words [&_[data-slot=amount]]:whitespace-normal">
            {secondary}
          </dd>
        </div>
      </dl>
    </div>
  );
}
