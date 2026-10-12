import { Suspense } from 'react';
import { NetWorthContainer } from '@/features/reports/net-worth/net-worth-container';
import { NetWorthSkeleton } from '@/features/reports/net-worth/net-worth-skeleton';

export default function NetWorthReportPage() {
  // useSearchParams needs a Suspense boundary to keep the page prerenderable.
  return (
    <Suspense fallback={<NetWorthSkeleton />}>
      <NetWorthContainer />
    </Suspense>
  );
}
