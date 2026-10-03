'use client';

import {
  ACCOUNT_CURRENCIES,
  type AccountResponse,
  type CategoryLanguage,
  type CategoryResponse,
  type MovementResponse,
} from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { categoryLabel } from '@/features/categories/category-display';
import type { CurrencyTotals } from '@/features/accounts/totals';
import { Link, useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { useApiClient } from '@/lib/api-client-provider';
import { HomeFrame, HomeScreen, HomeSkeleton } from '../components/home-screen';
import type { RecentMovementItem } from '../components/recent-movements';
import { browserTimeZone } from '../time-zone';

/** The API's largest page for accounts and categories; the home needs names, not pagination. */
const PAGE_SIZE = 100;

/** The home shows only the latest few movements; the full list lives at /movements. */
const RECENT_LIMIT = 5;

type HomeState =
  | { kind: 'loading' }
  | { kind: 'failed'; retrying: boolean }
  | {
      kind: 'ready';
      /** Active accounts: they decide the currencies shown in the balance. */
      accounts: AccountResponse[];
      /** Active and archived accounts by id, so a movement on an archived one keeps its currency. */
      knownAccounts: Map<string, AccountResponse>;
      availableTotals: CurrencyTotals;
      netWorthTotals: CurrencyTotals;
      movements: MovementResponse[];
      categories: Map<string, CategoryResponse>;
      timeZone: string;
    };

/**
 * Financial data lives in React state only: nothing here touches localStorage, sessionStorage or
 * IndexedDB. Every request starts in the same tick, so the home costs one round trip after the
 * session check.
 */
export function HomeContainer() {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('ui');
  const locale = useLocale() as Locale;
  const language: CategoryLanguage = locale === 'en' ? 'en' : 'es';
  const [state, setState] = useState<HomeState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    // A function, not the variable: TypeScript would narrow `active` to `true` across the await.
    const isActive = () => active;
    void (async () => {
      const [accounts, archivedAccounts, movements, profile, activeCategories, archivedCategories] =
        await Promise.all([
          api.listAccounts({ archived: false, limit: PAGE_SIZE }),
          api.listAccounts({ archived: true, limit: PAGE_SIZE }),
          api.listMovements({ limit: RECENT_LIMIT }),
          api.getProfile(),
          api.listCategories({ archived: false, limit: PAGE_SIZE }),
          api.listCategories({ archived: true, limit: PAGE_SIZE }),
        ]);
      if (!isActive()) return;
      // Any expired session redirects, even from a request whose failure would otherwise degrade.
      const answers = [
        accounts,
        archivedAccounts,
        movements,
        profile,
        activeCategories,
        archivedCategories,
      ];
      if (answers.some((answer) => !answer.ok && answer.code === 'UNAUTHENTICATED')) {
        router.replace('/sign-in');
        return;
      }
      if (!accounts.ok || !movements.ok) {
        setState({ kind: 'failed', retrying: false });
        return;
      }
      // Archived accounts, categories and the profile only refine the display (currency and name of
      // an archived account, category names and icons, time zone): a failure there falls back to
      // neutral labels instead of hiding the balance.
      const knownAccounts = new Map<string, AccountResponse>();
      for (const result of [archivedAccounts, accounts]) {
        if (result.ok)
          for (const account of result.data.items) knownAccounts.set(account.id, account);
      }
      const categories = new Map<string, CategoryResponse>();
      for (const result of [activeCategories, archivedCategories]) {
        if (result.ok)
          for (const category of result.data.items) categories.set(category.id, category);
      }
      setState({
        kind: 'ready',
        accounts: accounts.data.items,
        knownAccounts,
        availableTotals: accounts.data.availableTotals,
        netWorthTotals: accounts.data.netWorthTotals,
        movements: movements.data.items,
        categories,
        timeZone: profile.ok ? profile.data.preferences.timeZone : browserTimeZone(),
      });
    })();
    return () => {
      active = false;
    };
  }, [api, router, attempt]);

  function retry() {
    // Single-flight: the error state stays on screen with its retry button disabled
    // (`retrying`), so clicks while the new requests are in flight cannot send more.
    setState({ kind: 'failed', retrying: true });
    setAttempt((value) => value + 1);
  }

  if (state.kind === 'loading') return <HomeSkeleton />;

  if (state.kind === 'failed') {
    return (
      <HomeFrame>
        <ErrorState
          title={t('error.title')}
          description={t('error.description')}
          retryLabel={t('retry')}
          retrying={state.retrying}
          onRetry={retry}
        />
      </HomeFrame>
    );
  }

  if (state.accounts.length === 0) {
    return (
      <HomeFrame>
        <HomeEmptyAccounts />
      </HomeFrame>
    );
  }

  const movements: RecentMovementItem[] = state.movements.map((movement) => {
    const account = state.knownAccounts.get(movement.accountId);
    const category =
      movement.categoryId === null ? undefined : state.categories.get(movement.categoryId);
    return {
      id: movement.id,
      type: movement.type,
      amount: movement.amount,
      currency: account?.currency,
      occurredAt: movement.occurredAt,
      note: movement.note,
      categoryName: category === undefined ? undefined : categoryLabel(category, language),
      categoryIcon: category?.icon,
      categoryColor: category?.color,
      accountName: account?.name,
    };
  });

  return (
    <HomeScreen
      locale={locale}
      timeZone={state.timeZone}
      currencies={ACCOUNT_CURRENCIES.filter((currency) =>
        state.accounts.some((account) => account.currency === currency),
      )}
      availableTotals={state.availableTotals}
      netWorthTotals={state.netWorthTotals}
      movements={movements}
    />
  );
}

function HomeEmptyAccounts() {
  const t = useTranslations('home.empty');

  return (
    <EmptyState
      title={t('title')}
      description={t('description')}
      action={
        <Link href="/accounts/new" className={buttonVariants()}>
          {t('action')}
        </Link>
      }
    />
  );
}
