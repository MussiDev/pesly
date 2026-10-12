import { DashboardContainer } from '@/features/dashboard/containers/dashboard-container';

// A Server Component with no data access: the figures are fetched by the client container
// through the Express API.
export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 md:p-8">
      <DashboardContainer />
    </main>
  );
}
