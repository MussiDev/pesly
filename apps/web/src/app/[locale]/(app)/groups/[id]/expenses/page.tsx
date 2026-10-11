import { GroupExpensesContainer } from '@/features/groups/expenses/list/group-expenses-container';

export default async function GroupExpensesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 md:p-8">
      <GroupExpensesContainer groupId={id} />
    </main>
  );
}
