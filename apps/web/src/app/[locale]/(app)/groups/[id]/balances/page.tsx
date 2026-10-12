import { GroupBalancesContainer } from '@/features/groups/balances/group-balances-container';

export default async function GroupBalancesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 md:p-8">
      <GroupBalancesContainer groupId={id} />
    </main>
  );
}
