import { CreateMovementContainer } from '@/features/movements/containers/create-movement-container';

export default function NewMovementPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4">
      <CreateMovementContainer />
    </main>
  );
}
