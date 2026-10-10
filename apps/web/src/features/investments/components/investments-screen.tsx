'use client';

import type {
  AddHoldingRequest,
  CreatePortfolioRequest,
  HoldingResponse,
  PortfolioResponse,
  SetPriceRequest,
  UpdateHoldingRequest,
  ValuationCurrency,
} from '@pesly/shared';
import { Briefcase, CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { Locale } from '@/i18n/routing';
import { formatQuantity } from '@/lib/format-amount';
import type { HoldingFormErrors, InvestmentErrorKey } from '../holding-form-errors';
import { AddHoldingForm } from './add-holding-form';
import { CreatePortfolioForm } from './create-portfolio-form';
import { EditHoldingForm } from './edit-holding-form';
import {
  ImportHoldingsDialog,
  type HoldingsImportPlan,
  type ImportDialogError,
} from './import-holdings-dialog';
import { PortfolioCard } from './portfolio-card';
import { PriceForm } from './price-form';

/** The one form or confirmation that is open; opening another closes the previous one. */
export type OpenForm =
  | { kind: 'create' }
  | { kind: 'add'; portfolioId: string }
  | { kind: 'edit'; holdingId: string }
  | { kind: 'price'; holdingId: string }
  | { kind: 'import'; portfolioId: string }
  | { kind: 'delete-portfolio'; portfolioId: string };

export type InvestmentsNotice =
  | { kind: 'merged'; ticker: string; quantity: string }
  | { kind: 'deleted' }
  | { kind: 'automaticPrice'; ticker: string; holdingId: string }
  | { kind: 'imported'; created: number; updated: number; removed: number };

/** What the open import shows: the plan once a file was read, or why it could not be. */
export interface ImportDraft {
  reading: boolean;
  plan: HoldingsImportPlan | null;
  error: ImportDialogError | null;
}

/** A message above one portfolio. The object is created once per failure, so focus moves once. */
export interface PortfolioMessage {
  key: InvestmentErrorKey;
}

export interface InvestmentsScreenProps {
  state: 'loading' | 'failed' | 'loaded';
  portfolios: PortfolioResponse[];
  /** Why the last load failed; with `loaded` the list shown is the previous one. */
  loadError?: InvestmentErrorKey;
  language: Locale;
  timeZone: string;
  pending: boolean;
  openForm: OpenForm | null;
  /** Remounts the create form after each successful creation, so it starts empty. */
  createRevision: number;
  notice: InvestmentsNotice | null;
  messages: Record<string, PortfolioMessage | undefined>;
  formErrors: HoldingFormErrors | undefined;
  /** The import is offered only when the container handles it. */
  importDraft?: ImportDraft;
  onImportFile?: (portfolioId: string, file: File) => void;
  onImportCurrency?: (ticker: string, currency: ValuationCurrency) => void;
  onImportConfirm?: (portfolioId: string) => void;
  onRetry: () => void;
  onOpenForm: (form: OpenForm) => void;
  onCloseForm: () => void;
  onCreatePortfolio: (values: CreatePortfolioRequest) => void;
  onAddHolding: (portfolioId: string, values: AddHoldingRequest) => void;
  onEditHolding: (holdingId: string, values: UpdateHoldingRequest) => void;
  onSetPrice: (holdingId: string, values: SetPriceRequest) => void;
  onDeleteHolding: (holdingId: string) => void;
  onUseAutomaticPrice?: (holdingId: string) => void;
  onDeletePortfolio: (portfolioId: string) => void;
}

/** Moves focus to what just appeared, so a screen reader announces it. */
function useFocusOnMount<T extends HTMLElement>(dependency: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [dependency]);
  return ref;
}

function MessageAlert({ message }: { message: PortfolioMessage }) {
  const t = useTranslations('investments.errors');
  const ref = useFocusOnMount<HTMLDivElement>(message);
  return (
    <Alert ref={ref} variant="destructive" tabIndex={-1}>
      <CircleAlert aria-hidden />
      <AlertDescription>{t(message.key)}</AlertDescription>
    </Alert>
  );
}

function Panel({
  title,
  level,
  children,
}: {
  title: string;
  level: 'h2' | 'h3';
  children: ReactNode;
}) {
  const ref = useFocusOnMount<HTMLHeadingElement>(null);
  const Heading = level;
  return (
    <Card className="gap-4">
      <CardHeader>
        <Heading ref={ref} tabIndex={-1} className="text-heading outline-none">
          {title}
        </Heading>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

function findHolding(portfolio: PortfolioResponse, holdingId: string): HoldingResponse | undefined {
  return portfolio.holdings.find((holding) => holding.id === holdingId);
}

/** The layout of the investments page; every state arrives through props. */
export function InvestmentsScreen(props: InvestmentsScreenProps) {
  const {
    state,
    portfolios,
    loadError,
    language,
    timeZone,
    pending,
    openForm,
    createRevision,
    notice,
    messages,
    formErrors,
  } = props;
  const t = useTranslations('investments');
  const tApp = useTranslations('app');
  const tUi = useTranslations('ui');
  const tErrors = useTranslations('investments.errors');
  const rootRef = useRef<HTMLDivElement>(null);
  const opener = useRef<{ element: HTMLElement; key: string | null; label: string | null } | null>(
    null,
  );
  const previousForm = useRef(openForm);
  // The last control inside the screen that held focus, to notice when it is removed from the page.
  const lastFocused = useRef<HTMLElement | null>(null);

  /** The screen's heading: the page's h1 when there is one, else the screen itself. */
  function focusHeading() {
    const root = rootRef.current;
    if (!root) return;
    const heading = (root.closest('main') ?? document).querySelector('h1') ?? root;
    if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
    heading.focus();
  }

  /** Opens a form and remembers the control that opened it, to give focus back on close. */
  function openPanel(form: OpenForm) {
    const active = document.activeElement;
    opener.current =
      active instanceof HTMLElement && active !== document.body
        ? {
            element: active,
            key: active.dataset.opener ?? null,
            label: active.getAttribute('aria-label') ?? active.textContent,
          }
        : null;
    props.onOpenForm(form);
  }

  // When a panel closes, focus goes back to its opener. A button hidden while its panel was open
  // is a new element when it comes back, so it is found again by its `data-opener` key, which names
  // the portfolio (a label alone would match the first portfolio's button). A control with no key
  // (the create button) is found by its label. If the opener no longer exists, for instance a
  // deleted portfolio's button, focus goes to the heading, a safe non-destructive place; never to
  // another portfolio's delete button.
  useEffect(() => {
    const wasOpen = previousForm.current !== null;
    previousForm.current = openForm;
    const root = rootRef.current;
    if (!wasOpen || openForm !== null || !root) return;
    const remembered = opener.current;
    opener.current = null;
    let target: HTMLElement | undefined;
    if (remembered?.element.isConnected) target = remembered.element;
    else if (remembered?.key != null) {
      target = Array.from(root.querySelectorAll<HTMLElement>('[data-opener]')).find(
        (candidate) => candidate.dataset.opener === remembered.key,
      );
    } else if (remembered?.label != null) {
      target = Array.from(root.querySelectorAll('button')).find(
        (button) => (button.getAttribute('aria-label') ?? button.textContent) === remembered.label,
      );
    }
    if (!target) {
      // The h1 is outside the root, so focusing it never updates `lastFocused`; drop the removed
      // control or a later list change would pull focus back to the heading.
      lastFocused.current = null;
      focusHeading();
      return;
    }
    if (target.tabIndex < 0 && !target.hasAttribute('tabindex')) target.tabIndex = -1;
    target.focus();
    lastFocused.current = target;
  }, [openForm]);

  // The switch to the automatic price removes the button that was pressed, with its warning. Focus
  // goes to the holding's details toggle, which stays, and the status region announces the change.
  useEffect(() => {
    if (notice?.kind !== 'automaticPrice') return;
    const root = rootRef.current;
    if (!root) return;
    const toggle = Array.from(root.querySelectorAll<HTMLElement>('[data-details-toggle]')).find(
      (candidate) => candidate.dataset.detailsToggle === notice.holdingId,
    );
    if (!toggle) {
      focusHeading();
      return;
    }
    toggle.focus();
    lastFocused.current = toggle;
  }, [notice]);

  // A control that had focus and is gone after the list changed (a deleted portfolio or holding,
  // or the opener of a form closed by its own deletion) leaves focus on the body: move it to the
  // heading. Focus the user moved elsewhere on purpose is left alone.
  useEffect(() => {
    const gone = lastFocused.current;
    if (!gone || gone.isConnected) return;
    lastFocused.current = null;
    const active = document.activeElement;
    if (active === null || active === document.body || !active.isConnected) focusHeading();
  }, [portfolios]);

  if (state === 'loading') {
    // Same frame as the loaded screen: the create button, then a portfolio card.
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="sr-only">
          {tApp('loading')}
        </p>
        <Skeleton className="h-11 w-40" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    );
  }

  const loadFailure = (error: InvestmentErrorKey) => (
    <ErrorState
      title={tUi('error.title')}
      description={tErrors(error)}
      retryLabel={tApp('retry')}
      onRetry={props.onRetry}
    />
  );

  if (state === 'failed') return loadFailure(loadError ?? 'unexpected');

  const createForm = (
    <CreatePortfolioForm
      key={createRevision}
      pending={pending}
      errors={openForm?.kind === 'create' || portfolios.length === 0 ? formErrors : undefined}
      onSubmit={props.onCreatePortfolio}
      onCancel={portfolios.length === 0 ? undefined : props.onCloseForm}
    />
  );

  return (
    <div
      ref={rootRef}
      className="flex flex-col gap-4"
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLElement) lastFocused.current = event.target;
      }}
    >
      {loadError && loadFailure(loadError)}
      <p role="status" className="text-small text-muted-foreground empty:sr-only">
        {notice?.kind === 'merged'
          ? t('notices.merged', {
              ticker: notice.ticker,
              quantity: formatQuantity(BigInt(notice.quantity), language),
            })
          : notice?.kind === 'deleted'
            ? t('notices.deleted')
            : notice?.kind === 'automaticPrice'
              ? t('notices.automaticPrice', { ticker: notice.ticker })
              : notice?.kind === 'imported'
                ? t('import.done', {
                    created: notice.created,
                    updated: notice.updated,
                    removed: notice.removed,
                  })
                : null}
      </p>
      {portfolios.length === 0 ? (
        <EmptyState
          title={t('empty.title')}
          description={t('empty.description')}
          icon={<Briefcase aria-hidden />}
          action={<div className="w-full max-w-sm text-left">{createForm}</div>}
        />
      ) : (
        <>
          {openForm?.kind === 'create' ? (
            <Panel title={t('forms.createPortfolio.title')} level="h2">
              {createForm}
            </Panel>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => {
                openPanel({ kind: 'create' });
              }}
            >
              {t('forms.createPortfolio.title')}
            </Button>
          )}
          {portfolios.map((portfolio) => {
            const message = messages[portfolio.id];
            // The form's own submit button has the same name, so the opener steps aside.
            const adding = openForm?.kind === 'add' && openForm.portfolioId === portfolio.id;
            const importing =
              props.onImportFile !== undefined &&
              openForm?.kind === 'import' &&
              openForm.portfolioId === portfolio.id;
            const editing =
              openForm?.kind === 'edit' ? findHolding(portfolio, openForm.holdingId) : undefined;
            const pricing =
              openForm?.kind === 'price' ? findHolding(portfolio, openForm.holdingId) : undefined;
            return (
              <section key={portfolio.id} className="flex flex-col gap-3">
                {message && <MessageAlert message={message} />}
                <PortfolioCard
                  portfolio={portfolio}
                  language={language}
                  timeZone={timeZone}
                  pending={pending}
                  onAddHolding={
                    adding
                      ? undefined
                      : (portfolioId) => {
                          openPanel({ kind: 'add', portfolioId });
                        }
                  }
                  onImportHoldings={
                    props.onImportFile === undefined || importing
                      ? undefined
                      : (portfolioId) => {
                          openPanel({ kind: 'import', portfolioId });
                        }
                  }
                  onDeletePortfolio={(portfolioId) => {
                    openPanel({ kind: 'delete-portfolio', portfolioId });
                  }}
                  onEditHolding={(holdingId) => {
                    openPanel({ kind: 'edit', holdingId });
                  }}
                  onSetPrice={(holdingId) => {
                    openPanel({ kind: 'price', holdingId });
                  }}
                  onDeleteHolding={props.onDeleteHolding}
                  onUseAutomaticPrice={props.onUseAutomaticPrice}
                />
                {adding && (
                  <Panel title={t('forms.addHolding.title')} level="h3">
                    <AddHoldingForm
                      language={language}
                      pending={pending}
                      errors={formErrors}
                      onSubmit={(values) => {
                        props.onAddHolding(portfolio.id, values);
                      }}
                      onCancel={props.onCloseForm}
                    />
                  </Panel>
                )}
                {importing && (
                  <Panel title={t('import.title')} level="h3">
                    <ImportHoldingsDialog
                      language={language}
                      pending={pending}
                      reading={props.importDraft?.reading ?? false}
                      plan={props.importDraft?.plan ?? null}
                      error={props.importDraft?.error ?? null}
                      onFile={(file) => {
                        props.onImportFile?.(portfolio.id, file);
                      }}
                      onCurrencyChange={(ticker, currency) => {
                        props.onImportCurrency?.(ticker, currency);
                      }}
                      onConfirm={() => {
                        props.onImportConfirm?.(portfolio.id);
                      }}
                      onCancel={props.onCloseForm}
                    />
                  </Panel>
                )}
                {editing && (
                  <Panel title={t('forms.editHolding.title')} level="h3">
                    <EditHoldingForm
                      key={editing.id}
                      holding={editing}
                      language={language}
                      pending={pending}
                      errors={formErrors}
                      onSubmit={(values) => {
                        props.onEditHolding(editing.id, values);
                      }}
                      onCancel={props.onCloseForm}
                    />
                  </Panel>
                )}
                {pricing && (
                  <Panel title={t('forms.price.title')} level="h3">
                    <PriceForm
                      key={pricing.id}
                      language={language}
                      pending={pending}
                      errors={formErrors}
                      onSubmit={(values) => {
                        props.onSetPrice(pricing.id, values);
                      }}
                      onCancel={props.onCloseForm}
                    />
                  </Panel>
                )}
                {openForm?.kind === 'delete-portfolio' && openForm.portfolioId === portfolio.id && (
                  <Panel title={t('portfolio.delete')} level="h3">
                    <p className="text-small">{t('forms.confirmDelete.portfolio')}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={pending}
                        onClick={() => {
                          props.onDeletePortfolio(portfolio.id);
                        }}
                      >
                        {t('forms.confirmDelete.confirm')}
                      </Button>
                      <Button type="button" variant="outline" onClick={props.onCloseForm}>
                        {t('forms.cancel')}
                      </Button>
                    </div>
                  </Panel>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
