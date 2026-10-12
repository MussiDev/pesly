import { Skeleton } from '@/components/ui/skeleton';

/** The final layout of the screen as placeholders: currency note, chart, detail and list rows. */
export function NetWorthSkeleton() {
  return (
    <div data-testid="net-worth-skeleton" className="grid min-w-0 gap-3">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}
