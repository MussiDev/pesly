import { CreditCardDetailContainer } from '@/features/credit-cards/containers/credit-card-detail-container';

export default async function CreditCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 md:p-8">
      <CreditCardDetailContainer cardId={id} />
    </main>
  );
}
