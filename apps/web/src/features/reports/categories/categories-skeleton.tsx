import { Skeleton } from '@/components/ui/skeleton';

/** The final layout of the screen as a skeleton: total, ring with legend, then the list. */
export function CategoriesSkeleton() {
  return (
    <>
      <Skeleton className="h-8 w-1/2" />
      <div className="flex items-center gap-5">
        <Skeleton className="size-28 shrink-0 rounded-pill" />
        <div className="grid flex-1 gap-2.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </>
  );
}
