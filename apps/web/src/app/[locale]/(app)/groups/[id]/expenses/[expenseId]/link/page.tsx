import { LinkExpenseContainer } from '@/features/groups/expenses/link/link-expense-container';

export default async function GroupExpenseLinkPage({
  params,
}: {
  params: Promise<{ id: string; expenseId: string }>;
}) {
  const { id, expenseId } = await params;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 md:p-8">
      <LinkExpenseContainer groupId={id} expenseId={expenseId} />
    </main>
  );
}
