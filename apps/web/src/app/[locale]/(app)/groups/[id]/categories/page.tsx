import { GroupCategoriesContainer } from '@/features/groups/containers/group-categories-container';

export default async function GroupCategoriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 md:p-8">
      <GroupCategoriesContainer groupId={id} />
    </main>
  );
}
