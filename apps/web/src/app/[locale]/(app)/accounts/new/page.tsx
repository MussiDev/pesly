import { CreateAccountContainer } from '@/features/accounts/containers/create-account-container';

export default function NewAccountPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4 md:p-8">
      <CreateAccountContainer />
    </main>
  );
}
