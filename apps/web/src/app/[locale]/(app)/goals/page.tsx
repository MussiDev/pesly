import { GoalsContainer } from '@/features/goals/list/goals-container';

export default function GoalsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 md:p-8">
      <GoalsContainer />
    </main>
  );
}
