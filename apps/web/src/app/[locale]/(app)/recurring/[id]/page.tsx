import { PaymentDetailContainer } from '@/features/recurring/containers/payment-detail-container';

export default async function RecurringPaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4 md:p-8">
      <PaymentDetailContainer paymentId={id} />
    </main>
  );
}
