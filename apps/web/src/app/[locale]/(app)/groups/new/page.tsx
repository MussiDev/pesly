import { CreateGroupContainer } from '@/features/groups/containers/create-group-container';

export default function NewGroupPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4 md:p-8">
      <CreateGroupContainer />
    </main>
  );
}
