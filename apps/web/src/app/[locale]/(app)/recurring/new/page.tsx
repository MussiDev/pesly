import { PaymentFormContainer } from '@/features/recurring/containers/payment-form-container';

export default function NewRecurringPaymentPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4 md:p-8">
      <PaymentFormContainer />
    </main>
  );
}
