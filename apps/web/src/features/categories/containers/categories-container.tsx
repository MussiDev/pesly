'use client';

import {
  categoryIconSchema,
  categoryColorSchema,
  categoryNameSchema,
  type CategoryKind,
  type CategoryLanguage,
  type CategoryResponse,
} from '@pesly/shared';
import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PillTabs } from '@/components/ui/pill-tabs';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { useRouter } from '@/i18n/navigation';
import type { ApiFailure, UpdateCategoryInput } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { categoryLabel } from '../category-display';
import { nameErrorMessage, type CategoryFieldMessage } from '../category-form-errors';
import { CategoryList, type CategoryEditValues } from '../components/category-list';
import {
  CategoriesLoadStateView,
  type CategoriesLoadState,
} from '../components/categories-load-state';
import { CreateCategoryContainer } from './create-category-container';

/** The API's largest page; the container keeps asking until `total` is reached. */
const PAGE_SIZE = 100;

type ListState = CategoriesLoadState | { kind: 'ready'; categories: CategoryResponse[] };

/**
 * Lists the active or the archived categories and runs the row actions. After an action the row
 * leaves the view at once and the list is read again, so the view stays the API's.
 */
export function CategoriesContainer() {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const language: CategoryLanguage = locale === 'en' ? 'en' : 'es';
  const t = useTranslations('categories');
  const [kind, setKind] = useState<CategoryKind>('expense');
  // The create form waits behind "New", so the list is what the page opens on.
  const [creating, setCreating] = useState(false);
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [showArchived, setShowArchived] = useState(false);
  // `silent` reloads (after an action) keep the list on screen and report failures as an alert.
  const [request, setRequest] = useState({ id: 0, silent: false });
  const [pending, setPending] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | undefined>();
  const [blockedDeleteId, setBlockedDeleteId] = useState<string | undefined>();
  const [editError, setEditError] = useState<CategoryFieldMessage | undefined>();
  const [actionError, setActionError] = useState<ErrorMessageKey | undefined>();

  useEffect(() => {
    let active = true;
    // A function, not the variable: TypeScript would narrow `active` to `true` across the awaits.
    const isActive = () => active;
    void (async () => {
      const categories: CategoryResponse[] = [];
      for (;;) {
        const result = await api.listCategories({
          archived: showArchived,
          limit: PAGE_SIZE,
          offset: categories.length,
        });
        if (!isActive()) return;
        if (!result.ok) {
          if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
          else if (request.silent) setActionError(result.messageKey);
          else setState({ kind: 'failed', error: result.messageKey });
          return;
        }
        categories.push(...result.data.items);
        // An empty page ends the loop even if `total` was stale, so it cannot spin.
        if (result.data.items.length === 0 || categories.length >= result.data.total) break;
      }
      setState({ kind: 'ready', categories });
    })();
    return () => {
      active = false;
    };
  }, [api, router, showArchived, request]);

  function clearTransient() {
    setEditingId(undefined);
    setConfirmingDeleteId(undefined);
    setBlockedDeleteId(undefined);
    setEditError(undefined);
    setActionError(undefined);
  }

  function toggleArchived() {
    clearTransient();
    setCreating(false);
    setState({ kind: 'loading' });
    setRequest((current) => ({ id: current.id + 1, silent: false }));
    setShowArchived((value) => !value);
  }

  function retry() {
    setState({ kind: 'loading' });
    setRequest((current) => ({ id: current.id + 1, silent: false }));
  }

  /** Removes `ids` from the view and reads the list again. */
  function leaveView(ids: ReadonlySet<string>) {
    setState((current) =>
      current.kind === 'ready'
        ? { ...current, categories: current.categories.filter((item) => !ids.has(item.id)) }
        : current,
    );
    setRequest((current) => ({ id: current.id + 1, silent: true }));
  }

  /** `true` when the failure was handled here; otherwise the caller decides what to show. */
  function handleSharedFailure(failure: ApiFailure): boolean {
    if (failure.code !== 'UNAUTHENTICATED') return false;
    router.replace('/sign-in');
    return true;
  }

  function replaceInView(updated: CategoryResponse) {
    setState((current) =>
      current.kind === 'ready'
        ? {
            ...current,
            categories: current.categories.map((item) => (item.id === updated.id ? updated : item)),
          }
        : current,
    );
  }

  async function edit(id: string, values: CategoryEditValues) {
    if (state.kind !== 'ready') return;
    const current = state.categories.find((item) => item.id === id);
    if (current === undefined) return;

    const body: UpdateCategoryInput = {};
    // Only a changed name makes a default the user's own (D4): the field starts with the label.
    if (values.name.normalize('NFC').trim() !== categoryLabel(current, language)) {
      const name = categoryNameSchema.safeParse(values.name);
      if (!name.success) {
        setEditError(nameErrorMessage(values.name));
        return;
      }
      body.name = name.data;
    }
    const icon = categoryIconSchema.safeParse(values.icon);
    if (icon.success && icon.data !== current.icon) body.icon = icon.data;
    const color = categoryColorSchema.safeParse(values.color);
    if (color.success && color.data !== current.color) body.color = color.data;

    if (Object.keys(body).length === 0) {
      setEditingId(undefined);
      setEditError(undefined);
      return;
    }
    setPending(true);
    setEditError(undefined);
    setActionError(undefined);
    const result = await api.updateCategory(id, body);
    setPending(false);
    if (result.ok) {
      replaceInView(result.data);
      setEditingId(undefined);
    } else if (handleSharedFailure(result)) {
      return;
    } else if (result.code === 'CATEGORY_NAME_TAKEN') {
      setEditError('errors.categoryNameTaken');
    } else {
      setActionError(result.messageKey);
    }
  }

  async function setArchived(id: string, archived: boolean) {
    setPending(true);
    setActionError(undefined);
    const result = await (archived ? api.archiveCategory(id) : api.unarchiveCategory(id));
    setPending(false);
    if (result.ok) {
      setBlockedDeleteId(undefined);
      // Archiving a parent archives its subcategories; unarchiving restores only the row (D7).
      const leaving = new Set([id]);
      if (archived && state.kind === 'ready') {
        for (const item of state.categories) if (item.parentId === id) leaving.add(item.id);
      }
      leaveView(leaving);
    } else if (!handleSharedFailure(result)) {
      setActionError(result.messageKey);
    }
  }

  async function remove(id: string) {
    setPending(true);
    setActionError(undefined);
    const result = await api.deleteCategory(id);
    setPending(false);
    if (result.ok) {
      setConfirmingDeleteId(undefined);
      leaveView(new Set([id]));
    } else if (handleSharedFailure(result)) {
      return;
    } else if (result.code === 'CATEGORY_IN_USE') {
      setConfirmingDeleteId(undefined);
      setBlockedDeleteId(id);
    } else {
      setActionError(result.messageKey);
    }
  }

  function created(category: CategoryResponse) {
    setState((current) =>
      current.kind === 'ready'
        ? { ...current, categories: [...current.categories, category] }
        : current,
    );
  }

  if (state.kind !== 'ready') {
    return <CategoriesLoadStateView state={state} onRetry={retry} />;
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillTabs
          label={t('tabs.label')}
          options={[
            { value: 'expense', label: t('sections.expense') },
            { value: 'income', label: t('sections.income') },
          ]}
          value={kind}
          onChange={(next) => {
            clearTransient();
            setKind(next);
          }}
        />
        {showArchived || creating ? null : (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              clearTransient();
              setCreating(true);
            }}
          >
            <Plus aria-hidden />
            {t('new.open')}
          </Button>
        )}
      </div>
      {creating && !showArchived ? (
        <CreateCategoryContainer
          categories={state.categories}
          language={language}
          defaultKind={kind}
          onCancel={() => {
            setCreating(false);
          }}
          onCreated={(category) => {
            created(category);
            setKind(category.kind);
            setCreating(false);
          }}
        />
      ) : null}
      <CategoryList
        categories={state.categories}
        language={language}
        showArchived={showArchived}
        kind={kind}
        onCreateFirst={() => {
          setCreating(true);
        }}
        pending={pending}
        editingId={editingId}
        confirmingDeleteId={confirmingDeleteId}
        blockedDeleteId={blockedDeleteId}
        editError={editError}
        actionError={actionError}
        onToggleArchived={toggleArchived}
        onStartEdit={(id) => {
          clearTransient();
          setEditingId(id);
        }}
        onCancelEdit={() => {
          setEditingId(undefined);
          setEditError(undefined);
        }}
        onSaveEdit={(id, values) => {
          void edit(id, values);
        }}
        onArchive={(id) => {
          void setArchived(id, true);
        }}
        onUnarchive={(id) => {
          void setArchived(id, false);
        }}
        onAskDelete={(id) => {
          clearTransient();
          setConfirmingDeleteId(id);
        }}
        onCancelDelete={() => {
          setConfirmingDeleteId(undefined);
        }}
        onConfirmDelete={(id) => {
          void remove(id);
        }}
      />
    </div>
  );
}
