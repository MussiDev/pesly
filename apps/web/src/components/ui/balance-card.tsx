import type { ReactNode } from 'react';

interface BalanceCardProps {
  /** The accessible name of the group, e.g. the currency. */
  label: string;
  primaryLabel: string;
  primary: ReactNode;
  secondaryLabel: string;
  secondary: ReactNode;
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
}: BalanceCardProps) {
  return (
    <div
      data-slot="balance-card"
      role="group"
      aria-label={label}
      className="relative min-w-0 overflow-hidden rounded-2xl bg-hero p-5 text-hero-foreground shadow-md"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-12 size-48 rounded-full bg-hero-foreground/10 blur-2xl"
      />
      <dl className="relative grid gap-4">
        <div className="grid min-w-0 gap-1">
          <dt className="text-small text-hero-muted">{primaryLabel}</dt>
          <dd className="text-title break-words sm:text-display [&_[data-slot=amount]]:whitespace-normal">
            {primary}
          </dd>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-hero-foreground/10 px-3 py-2">
          <dt className="text-small text-hero-muted">{secondaryLabel}</dt>
          <dd className="text-small font-semibold break-words [&_[data-slot=amount]]:whitespace-normal">
            {secondary}
          </dd>
        </div>
      </dl>
    </div>
  );
}
