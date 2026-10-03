'use client';

import type {
  AddHoldingRequest,
  CreatePortfolioRequest,
  PortfolioResponse,
  SetPriceRequest,
  UpdateHoldingRequest,
} from '@pesly/shared';
import { useLocale } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import type { ApiFailure, ApiResult } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import {
  InvestmentsScreen,
  type InvestmentsNotice,
  type OpenForm,
  type PortfolioMessage,
} from '../components/investments-screen';
import {
  toHoldingFailure,
  type HoldingFormContext,
  type HoldingFormErrors,
  type InvestmentErrorKey,
} from '../holding-form-errors';

type ListState =
  | { kind: 'loading' }
  | { kind: 'failed'; error: InvestmentErrorKey }
  | { kind: 'loaded'; portfolios: PortfolioResponse[]; error?: InvestmentErrorKey };

function browserTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Investments: loads the portfolios and runs every change through the API, then reloads the list
 * so every value shown (totals, gains, stale prices) is the server's, never computed here.
 */
export function InvestmentsContainer() {
  const api = useApiClient();
  const router = useRouter();
  // The routing config only allows these two locales, so the cast cannot lie.
  const language = useLocale() as Locale;
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [openForm, setOpenForm] = useState<OpenForm | null>(null);
  const [formErrors, setFormErrors] = useState<HoldingFormErrors | undefined>(undefined);
  const [messages, setMessages] = useState<Record<string, PortfolioMessage | undefined>>({});
  const [notice, setNotice] = useState<InvestmentsNotice | null>(null);
  const [createRevision, setCreateRevision] = useState(0);
  const mounted = useRef(true);
  const requestId = useRef(0);
  // The form on screen right now, readable from a change that finishes later.
  const openFormRef = useRef<OpenForm | null>(null);
  // Changes still waiting for the API; `pending` stays true until all of them settle.
  const inFlight = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The user's time zone is read once; a failed call falls back to the browser's.
  useEffect(() => {
    let active = true;
    void api.getSession().then((result) => {
      if (!active) return;
      setTimeZone(result.ok ? result.data.user.timeZone : browserTimeZone());
    });
    return () => {
      active = false;
    };
  }, [api]);

  /**
   * Fetches the list; a failure keeps the previous one. Resolves `failed` when it did not load and
   * `stale` when a newer load took over (that one reports the outcome).
   */
  const load = useCallback(async (): Promise<'loaded' | 'failed' | 'stale'> => {
    const id = ++requestId.current;
    const result = await api.listPortfolios();
    if (!mounted.current || id !== requestId.current) return 'stale';
    if (result.ok) {
      setList({ kind: 'loaded', portfolios: result.data.portfolios });
      return 'loaded';
    }
    if (result.code === 'UNAUTHENTICATED') {
      router.replace('/sign-in');
      return 'failed';
    }
    const error = toHoldingFailure(result, 'portfolio').form ?? 'unexpected';
    setList((previous) =>
      previous.kind === 'loaded'
        ? { kind: 'loaded', portfolios: previous.portfolios, error }
        : { kind: 'failed', error },
    );
    return 'failed';
  }, [api, router]);

  useEffect(() => {
    if (timeZone === null) return;
    void load();
  }, [timeZone, load, attempt]);

  const portfolios = list.kind === 'loaded' ? list.portfolios : [];

  /** The portfolio a holding belongs to, to show its failure above it. */
  function portfolioOfHolding(holdingId: string): string | undefined {
    return portfolios.find((portfolio) =>
      portfolio.holdings.some((holding) => holding.id === holdingId),
    )?.id;
  }

  function showForm(form: OpenForm | null) {
    openFormRef.current = form;
    setOpenForm(form);
  }

  /**
   * Runs one change. `owns` tells whether the form on screen is the one this change came from: a
   * change that finishes after the user moved to another form must not close it nor put its errors
   * there. On success the list reloads; on failure `fail` shows it and nothing else changes.
   * Returns the data when it succeeded, and whether the reload after it worked.
   */
  async function mutate<T>(
    call: () => Promise<ApiResult<T>>,
    owns: (current: OpenForm | null) => boolean,
    fail: (failure: ApiFailure, stillOpen: boolean) => void,
  ): Promise<{ data: T; reloaded: boolean } | undefined> {
    inFlight.current += 1;
    setPending(true);
    setFormErrors(undefined);
    setMessages({});
    const result = await call();
    inFlight.current -= 1;
    if (!mounted.current) return undefined;
    setPending(inFlight.current > 0);
    if (result.ok) {
      if (owns(openFormRef.current)) showForm(null);
      setList((previous) =>
        previous.kind === 'loaded' ? { kind: 'loaded', portfolios: previous.portfolios } : previous,
      );
      const reloaded = (await load()) !== 'failed';
      return { data: result.data, reloaded };
    }
    if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    else fail(result, owns(openFormRef.current));
    return undefined;
  }

  /** Failures of a form stay in that form, if it is still the open one. */
  function formFailure(context: HoldingFormContext) {
    return (failure: ApiFailure, stillOpen: boolean) => {
      if (stillOpen) setFormErrors(toHoldingFailure(failure, context));
    };
  }

  function portfolioFailure(portfolioId: string | undefined) {
    return (failure: ApiFailure) => {
      const key = toHoldingFailure(failure, 'portfolio').form ?? 'unexpected';
      if (portfolioId === undefined) {
        setList((previous) =>
          previous.kind === 'loaded' ? { ...previous, error: key } : { kind: 'failed', error: key },
        );
      } else setMessages({ [portfolioId]: { key } });
    };
  }

  async function createPortfolio(values: CreatePortfolioRequest) {
    setNotice(null);
    // With no portfolios the create form is always on screen, with no open form behind it.
    const created = await mutate(
      () => api.createPortfolio(values),
      (current) => current === null || current.kind === 'create',
      formFailure('portfolio'),
    );
    if (created) setCreateRevision((value) => value + 1);
  }

  async function addHolding(portfolioId: string, values: AddHoldingRequest) {
    setNotice(null);
    const added = await mutate(
      () => api.addHolding(portfolioId, values),
      (current) => current?.kind === 'add' && current.portfolioId === portfolioId,
      formFailure('add'),
    );
    if (added?.reloaded && added.data.merged) {
      setNotice({
        kind: 'merged',
        ticker: added.data.holding.ticker,
        quantity: added.data.holding.quantity,
      });
    }
  }

  async function editHolding(holdingId: string, values: UpdateHoldingRequest) {
    setNotice(null);
    await mutate(
      () => api.updateHolding(holdingId, values),
      (current) => current?.kind === 'edit' && current.holdingId === holdingId,
      formFailure('edit'),
    );
  }

  async function setPrice(holdingId: string, values: SetPriceRequest) {
    setNotice(null);
    await mutate(
      () => api.setHoldingPrice(holdingId, values),
      (current) => current?.kind === 'price' && current.holdingId === holdingId,
      formFailure('price'),
    );
  }

  async function useAutomaticPrice(holdingId: string) {
    setNotice(null);
    // No form of its own: a failure shows above the holding's portfolio and nothing else changes.
    const switched = await mutate(
      () => api.setHoldingAutomaticPrice(holdingId),
      () => false,
      portfolioFailure(portfolioOfHolding(holdingId)),
    );
    if (switched?.reloaded) {
      setNotice({ kind: 'automaticPrice', ticker: switched.data.ticker, holdingId });
    }
  }

  async function deleteHolding(holdingId: string) {
    setNotice(null);
    const owner = portfolioOfHolding(holdingId);
    // Deleting a holding has no form of its own and never fills the one on screen, but an edit or
    // price form of this same holding would be left pointing at nothing, so it closes with it.
    const done = await mutate(
      async () => {
        const result = await api.deleteHolding(holdingId);
        return result.ok ? { ok: true as const, data: true } : result;
      },
      (current) =>
        (current?.kind === 'edit' || current?.kind === 'price') && current.holdingId === holdingId,
      portfolioFailure(owner),
    );
    if (done?.reloaded) setNotice({ kind: 'deleted' });
  }

  async function deletePortfolio(portfolioId: string) {
    setNotice(null);
    const done = await mutate(
      async () => {
        const result = await api.deletePortfolio(portfolioId);
        return result.ok ? { ok: true as const, data: true } : result;
      },
      (current) => current?.kind === 'delete-portfolio' && current.portfolioId === portfolioId,
      (failure, stillOpen) => {
        if (stillOpen) showForm(null);
        portfolioFailure(portfolioId)(failure);
      },
    );
    if (done?.reloaded) setNotice({ kind: 'deleted' });
  }

  function open(form: OpenForm) {
    setFormErrors(undefined);
    setMessages({});
    showForm(form);
  }

  function close() {
    setFormErrors(undefined);
    showForm(null);
  }

  return (
    <InvestmentsScreen
      state={list.kind}
      portfolios={portfolios}
      loadError={list.kind === 'loading' ? undefined : list.error}
      language={language}
      timeZone={timeZone ?? browserTimeZone()}
      pending={pending}
      openForm={openForm}
      createRevision={createRevision}
      notice={notice}
      messages={messages}
      formErrors={formErrors}
      onRetry={() => {
        setList((previous) =>
          previous.kind === 'loaded'
            ? { kind: 'loaded', portfolios: previous.portfolios }
            : { kind: 'loading' },
        );
        setAttempt((value) => value + 1);
      }}
      onOpenForm={open}
      onCloseForm={close}
      onCreatePortfolio={(values) => void createPortfolio(values)}
      onAddHolding={(portfolioId, values) => void addHolding(portfolioId, values)}
      onEditHolding={(holdingId, values) => void editHolding(holdingId, values)}
      onSetPrice={(holdingId, values) => void setPrice(holdingId, values)}
      onDeleteHolding={(holdingId) => void deleteHolding(holdingId)}
      onUseAutomaticPrice={(holdingId) => void useAutomaticPrice(holdingId)}
      onDeletePortfolio={(portfolioId) => void deletePortfolio(portfolioId)}
    />
  );
}
