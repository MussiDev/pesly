import { InstallmentPurchaseContainer } from '@/features/credit-cards/containers/installment-purchase-container';

export default async function InstallmentPurchasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 md:p-8">
      <InstallmentPurchaseContainer cardId={id} />
    </main>
  );
}
