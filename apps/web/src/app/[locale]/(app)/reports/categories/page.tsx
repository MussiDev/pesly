import { Suspense } from 'react';
import { CategoriesContainer } from '@/features/reports/categories/categories-container';
import { CategoriesSkeleton } from '@/features/reports/categories/categories-skeleton';
import { ReportLoading } from '@/features/reports/components/report-states';

// The layout already renders <main>, the header and the tabs. The address is read on the client,
// so the container needs a Suspense boundary to keep the page prerenderable.
export default function CategoriesPage() {
  return (
    <Suspense
      fallback={
        <ReportLoading>
          <CategoriesSkeleton />
        </ReportLoading>
      }
    >
      <CategoriesContainer />
    </Suspense>
  );
}
