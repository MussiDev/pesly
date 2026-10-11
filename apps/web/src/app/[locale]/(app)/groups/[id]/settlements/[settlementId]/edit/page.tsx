import { SettlementEditContainer } from '@/features/groups/settlements-edit/settlement-edit-container';

export default async function GroupSettlementEditPage({
  params,
}: {
  params: Promise<{ id: string; settlementId: string }>;
}) {
  const { id, settlementId } = await params;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 md:p-8">
      <SettlementEditContainer groupId={id} settlementId={settlementId} />
    </main>
  );
}
