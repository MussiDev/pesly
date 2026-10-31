import { Suspense } from 'react';
import { CategorySpendingContainer } from '@/features/category-spending/category-spending-container';

/** One category's spending in a month (`?id=&month=`), opened from the dashboard ring. */
export default function CategorySpendingPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4 md:p-8">
      {/* useSearchParams needs a Suspense boundary to keep the page prerenderable. */}
      <Suspense>
        <CategorySpendingContainer />
      </Suspense>
    </main>
  );
}
