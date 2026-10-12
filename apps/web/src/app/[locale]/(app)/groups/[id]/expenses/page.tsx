import { GroupExpensesPage } from '@/features/groups/category-views/group-expenses-page';

export default async function GroupExpensesRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 md:p-8">
      <GroupExpensesPage groupId={id} />
    </main>
  );
}
