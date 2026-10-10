import { CreateCreditCardContainer } from '@/features/credit-cards/containers/create-credit-card-container';

export default function NewCreditCardPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4 md:p-8">
      <CreateCreditCardContainer />
    </main>
  );
}
