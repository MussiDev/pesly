import { Skeleton } from '@/components/ui/skeleton';

/** The final layout of the screen as a skeleton: resolved range, chart, then the month list. */
export function IncomeExpensesSkeleton() {
  return (
    <div className="grid min-w-0 gap-4">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-48 w-full" />
      <div className="grid gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-11 w-full" />
        ))}
      </div>
    </div>
  );
}
