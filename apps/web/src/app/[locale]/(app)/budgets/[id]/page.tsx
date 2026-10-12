import { BudgetDetailContainer } from '@/features/budgets/detail/budget-detail-container';

export default async function BudgetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 md:p-8">
      <BudgetDetailContainer budgetId={id} />
    </main>
  );
}
