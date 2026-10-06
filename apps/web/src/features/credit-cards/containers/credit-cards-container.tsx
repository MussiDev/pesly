'use client';

import type { CreditCardResponse } from '@pesly/shared';
import { useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { CreditCardList } from '../components/credit-card-list';
import {
  CreditCardsLoadStateView,
  type CreditCardsLoadState,
} from '../components/credit-cards-load-state';

type ListState = CreditCardsLoadState | { kind: 'ready'; cards: CreditCardResponse[] };

/** Loads the signed-in user's cards (AC-01, AC-11). */
export function CreditCardsContainer() {
  const api = useApiClient();
  const router = useRouter();
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [request, setRequest] = useState(0);

  useEffect(() => {
    let active = true;
    void api.listCreditCards().then((result) => {
      if (!active) return;
      if (result.ok) setState({ kind: 'ready', cards: result.data.items });
      else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else setState({ kind: 'failed', error: result.messageKey });
    });
    return () => {
      active = false;
    };
  }, [api, router, request]);

  if (state.kind !== 'ready') {
    return (
      <CreditCardsLoadStateView
        state={state}
        onRetry={() => {
          setState({ kind: 'loading' });
          setRequest((current) => current + 1);
        }}
      />
    );
  }
  return <CreditCardList cards={state.cards} />;
}
