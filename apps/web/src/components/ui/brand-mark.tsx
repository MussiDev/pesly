import { cn } from '@/lib/utils';

/** The Pesly mark: a coin and a stem that read as a "P". Decorative: the wordmark next to it names the brand. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      data-slot="brand-mark"
      aria-hidden="true"
      viewBox="0 0 36 36"
      className={cn('size-9 shrink-0', className)}
    >
      <rect width="36" height="36" rx="11" className="fill-primary" />
      <rect x="10.5" y="9" width="4.5" height="18" rx="2.25" className="fill-primary-foreground" />
      <circle
        cx="19.5"
        cy="15.5"
        r="6.5"
        fill="none"
        strokeWidth="4.5"
        className="stroke-primary-foreground"
      />
    </svg>
  );
}
