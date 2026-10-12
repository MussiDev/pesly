import { BudgetsContainer } from '@/features/budgets/list/budgets-container';

export default function BudgetsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 md:p-8">
      <BudgetsContainer />
    </main>
  );
}
