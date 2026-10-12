import { Suspense } from 'react';
import { ReportLoading } from '@/features/reports/components/report-states';
import { IncomeExpensesContainer } from '@/features/reports/income-expenses/income-expenses-container';
import { IncomeExpensesSkeleton } from '@/features/reports/income-expenses/income-expenses-skeleton';

// The layout above already renders <main>, the header and the tabs.
export default function IncomeExpensesPage() {
  return (
    // useSearchParams needs a Suspense boundary to keep the page prerenderable.
    <Suspense
      fallback={
        <ReportLoading>
          <IncomeExpensesSkeleton />
        </ReportLoading>
      }
    >
      <IncomeExpensesContainer />
    </Suspense>
  );
}
