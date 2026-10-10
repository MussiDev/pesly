'use client';

import { CARD_NAME_MAX_LENGTH, cardNameSchema, type CreateCreditCardRequest } from '@pesly/shared';
import { useState } from 'react';
import { nameErrorMessage } from '@/features/accounts/account-form-errors';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { CreditCardForm, type CreditCardFormValues } from '../components/credit-card-form';
import { parseDay, type CardFormErrors } from '../credit-card-form-errors';

type FieldErrors = NonNullable<CardFormErrors['fields']>;

/** The request to send, or why there is none, field by field. */
function validate(
  values: CreditCardFormValues,
):
  | { request: CreateCreditCardRequest; fields?: undefined }
  | { request?: undefined; fields: FieldErrors } {
  const fields: FieldErrors = {};
  const name = cardNameSchema.safeParse(values.name);
  if (!name.success) fields.name = nameErrorMessage(values.name, CARD_NAME_MAX_LENGTH);
  const closingDay = parseDay(values.closingDay);
  if (closingDay === null) fields.closingDay = 'creditCards.errors.dayInvalid';
  const dueDay = parseDay(values.dueDay);
  if (dueDay === null) fields.dueDay = 'creditCards.errors.dayInvalid';
  if (!name.success || closingDay === null || dueDay === null) return { fields };
  return { request: { name: name.data, closingDay, dueDay } };
}

export function CreateCreditCardContainer() {
  const api = useApiClient();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<CardFormErrors>({});

  async function create(values: CreditCardFormValues) {
    const { request, fields } = validate(values);
    if (request === undefined) {
      setErrors({ fields });
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.createCreditCard(request);
    if (result.ok) {
      router.push('/cards');
      return;
    }
    setPending(false);
    if (result.code === 'UNAUTHENTICATED') {
      router.replace('/sign-in');
    } else if (result.code === 'ACCOUNT_NAME_TAKEN') {
      setErrors({ fields: { name: 'creditCards.errors.nameTaken' } });
    } else {
      // Network and unexpected failures: the form stays mounted, so the typed values stay.
      setErrors({ form: result.messageKey });
    }
  }

  return (
    <CreditCardForm
      pending={pending}
      errors={errors}
      onSubmit={(values) => {
        void create(values);
      }}
    />
  );
}
