'use client';

import type {
  CardCategoryRule,
  CategoryLanguage,
  CategoryResponse,
  CategorySuggestion,
  StatementImportResponse,
} from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { categoryLabel } from '@/features/categories/category-display';
import { loadAll } from '@/features/movements/use-movement-form-data';
import { Link, useRouter } from '@/i18n/navigation';
import type { ApiFailure } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import {
  CreditCardsLoadStateView,
  type CreditCardsLoadState,
} from '../components/credit-cards-load-state';
import {
  StatementImportView,
  type StatementImportAlert,
} from '../components/statement-import-view';
import {
  buildStatementImportRequest,
  needsGeneralCategory,
  suggestLineCategories,
  tooManyLines,
} from '../statement-import/import-request';
import { statementParser } from '../statement-import/statement-parser';
import {
  StatementParseError,
  type ParsedStatement,
  type StatementParser,
} from '../statement-import/statement-types';

/** The API's largest page; the loader keeps asking until `total` is reached. */
const PAGE_SIZE = 100;

type PageState =
  | CreditCardsLoadState
  | { kind: 'notFound' }
  | { kind: 'ready'; categories: CategoryResponse[]; rules: CardCategoryRule[] };

function failureAlert(failure: ApiFailure): StatementImportAlert {
  if (failure.code === 'NETWORK') return { path: 'creditCards.import.connectionNeeded' };
  if (failure.code === 'RATE_LIMITED') {
    return failure.retryAfterSeconds === undefined
      ? { path: 'movements.errors.rateLimitedGeneric' }
      : { path: 'movements.errors.rateLimited', seconds: failure.retryAfterSeconds };
  }
  return { path: `errors.${failure.messageKey satisfies ErrorMessageKey}` };
}

/**
 * The statement import screen: parses the chosen file on the device, previews its lines and sends
 * them in one request. Online only, like the other card writes. The parser is chosen by the file
 * type; a test can pass its own in the `StatementParser` shape.
 */
export function StatementImportContainer({
  cardId,
  parser = statementParser,
}: {
  cardId: string;
  parser?: StatementParser;
}) {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('creditCards.import');
  const language: CategoryLanguage = locale === 'en' ? 'en' : 'es';
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [fileError, setFileError] = useState<string | undefined>();
  const [passwordFile, setPasswordFile] = useState<{ file: File; wrong: boolean } | undefined>();
  const [statement, setStatement] = useState<ParsedStatement | undefined>();
  const [includeFees, setIncludeFees] = useState(true);
  const [categoryId, setCategoryId] = useState('');
  const [lineCategories, setLineCategories] = useState<ReadonlyMap<number, string>>(new Map());
  const [suggestions, setSuggestions] = useState<ReadonlyMap<number, CategorySuggestion>>(
    new Map(),
  );
  const [categoryError, setCategoryError] = useState(false);
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<StatementImportAlert | undefined>();
  const [result, setResult] = useState<StatementImportResponse | undefined>();

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.getCreditCard(cardId),
      loadAll((offset) =>
        api.listCategories({
          kind: 'expense',
          archived: false,
          limit: PAGE_SIZE,
          ...(offset > 0 ? { offset } : {}),
        }),
      ),
      api.listCardCategoryRules(),
    ]).then(([card, categories, rules]) => {
      if (!active) return;
      if (card.ok && categories.ok) {
        // The learned rules only improve the suggestions: without them the dictionary still works.
        setState({
          kind: 'ready',
          categories: categories.data,
          rules: rules.ok ? rules.data.rules : [],
        });
        return;
      }
      const failure = [card, categories].find((item): item is ApiFailure => !item.ok);
      if (failure === undefined) return;
      if (failure.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else if (failure.code === 'NOT_FOUND') setState({ kind: 'notFound' });
      else setState({ kind: 'failed', error: failure.messageKey });
    });
    return () => {
      active = false;
    };
  }, [api, router, cardId, attempt]);

  const openCategories =
    state.kind === 'ready'
      ? state.categories.filter((item) => item.kind === 'expense' && !item.archived)
      : [];

  function showStatement(parsed: ParsedStatement) {
    const rules = state.kind === 'ready' ? state.rules : [];
    const suggested = suggestLineCategories(
      parsed,
      rules,
      openCategories.map((item) => ({
        id: item.id,
        key: item.key,
        label: categoryLabel(item, language),
      })),
    );
    setSuggestions(suggested);
    setLineCategories(
      new Map([...suggested].map(([index, suggestion]) => [index, suggestion.categoryId])),
    );
    setStatement(parsed);
  }

  /** The password is handed to the parser for this one attempt and kept nowhere. */
  async function chooseFile(file: File | undefined, password?: string) {
    setStatement(undefined);
    setSuggestions(new Map());
    setLineCategories(new Map());
    setFileError(undefined);
    setAlert(undefined);
    setPasswordFile(undefined);
    if (file === undefined) return;
    setParsing(true);
    try {
      showStatement(await parser.parse(file, password === undefined ? undefined : { password }));
    } catch (error) {
      // Any unexpected failure reads as an unreadable file: the person can only pick another one.
      const code = error instanceof StatementParseError ? error.code : 'unreadable';
      if (code === 'passwordRequired' || code === 'wrongPassword') {
        setPasswordFile({ file, wrong: code === 'wrongPassword' });
      } else {
        setFileError(`creditCards.import.errors.${code}`);
      }
    } finally {
      setParsing(false);
    }
  }

  async function submit(parsed: ParsedStatement) {
    if (pending) return;
    if (categoryId === '' && needsGeneralCategory(parsed, includeFees, lineCategories)) {
      setCategoryError(true);
      return;
    }
    setCategoryError(false);
    setPending(true);
    setAlert(undefined);
    const outcome = await api.createStatementImport(
      cardId,
      buildStatementImportRequest(parsed, { includeFees, categoryId, lineCategories }),
    );
    setPending(false);
    if (outcome.ok) setResult(outcome.data);
    else if (outcome.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    else if (outcome.code === 'NOT_FOUND') setState({ kind: 'notFound' });
    // The preview stays mounted, so the chosen file and category are kept for a retry.
    else setAlert(failureAlert(outcome));
  }

  if (state.kind === 'notFound') {
    return (
      <EmptyState
        title={t('notFound')}
        action={
          <Link href="/cards" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {t('back')}
          </Link>
        }
      />
    );
  }
  if (state.kind !== 'ready') {
    return (
      <CreditCardsLoadStateView
        state={state}
        onRetry={() => {
          setState({ kind: 'loading' });
          setAttempt((current) => current + 1);
        }}
      />
    );
  }

  return (
    <StatementImportView
      cardId={cardId}
      accept={parser.accept}
      categories={openCategories.map((item) => ({
        id: item.id,
        label: categoryLabel(item, language),
      }))}
      lineCategories={lineCategories}
      suggestions={suggestions}
      onLineCategory={(index, id) => {
        setLineCategories((current) => {
          const next = new Map(current);
          if (id === '') next.delete(index);
          else next.set(index, id);
          return next;
        });
        setCategoryError(false);
      }}
      fileError={fileError}
      parsing={parsing}
      statement={statement}
      includeFees={includeFees}
      categoryId={categoryId}
      categoryError={categoryError}
      pending={pending}
      tooMany={statement !== undefined && tooManyLines(statement, includeFees)}
      alert={alert}
      result={result}
      passwordPrompt={passwordFile === undefined ? undefined : { wrong: passwordFile.wrong }}
      onPassword={(password) => {
        if (passwordFile) void chooseFile(passwordFile.file, password);
      }}
      onPasswordCancel={() => {
        setPasswordFile(undefined);
      }}
      onFile={(file) => {
        void chooseFile(file);
      }}
      onIncludeFees={setIncludeFees}
      onCategory={(id) => {
        setCategoryId(id);
        setCategoryError(false);
      }}
      onImport={() => {
        if (statement) void submit(statement);
      }}
    />
  );
}
