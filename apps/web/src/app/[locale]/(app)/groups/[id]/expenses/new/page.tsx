import { ExpenseFormContainer } from '@/features/groups/expenses/form/expense-form-container';

export default async function NewGroupExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 md:p-8">
      <ExpenseFormContainer groupId={id} />
    </main>
  );
}
