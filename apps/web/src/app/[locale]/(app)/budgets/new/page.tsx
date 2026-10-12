import { CreateBudgetContainer } from '@/features/budgets/form/create-budget-container';

export default function NewBudgetPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4 md:p-8">
      <CreateBudgetContainer />
    </main>
  );
}
