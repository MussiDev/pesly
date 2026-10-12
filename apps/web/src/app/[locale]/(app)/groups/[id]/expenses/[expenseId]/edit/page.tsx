import { ExpenseEditContainer } from '@/features/groups/expenses/edit/expense-edit-container';

export default async function GroupExpenseEditPage({
  params,
}: {
  params: Promise<{ id: string; expenseId: string }>;
}) {
  const { id, expenseId } = await params;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 md:p-8">
      <ExpenseEditContainer groupId={id} expenseId={expenseId} />
    </main>
  );
}
