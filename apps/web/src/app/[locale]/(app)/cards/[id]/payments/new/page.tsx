import { StatementPaymentContainer } from '@/features/credit-cards/containers/statement-payment-container';

export default async function StatementPaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 md:p-8">
      <StatementPaymentContainer cardId={id} />
    </main>
  );
}
