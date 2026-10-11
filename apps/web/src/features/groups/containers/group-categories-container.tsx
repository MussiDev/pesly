'use client';

import type { CategoryLanguage, GroupCategoryResponse } from '@pesly/shared';
import { Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Link, useRouter } from '@/i18n/navigation';
import type { ApiFailure, ApiResult } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import {
  buildGroupCategoryRequest,
  type GroupCategoryFieldErrors,
  type GroupCategoryFormValues,
} from '../category-request';
import { GroupCategoriesList } from '../components/group-categories-list';
import { GroupCategoryForm } from '../components/group-category-form';
import { GroupIssue } from '../components/group-issue';
import { GroupsLoadStateView, type GroupsLoadState } from '../components/groups-load-state';

type ScreenState =
  | GroupsLoadState
  | { kind: 'not-found' }
  | { kind: 'ready'; groupName: string; isAdmin: boolean; categories: GroupCategoryResponse[] };

/**
 * The categories of one group. The page makes two requests (NFR-02): the group, for the caller's
 * role, and its categories. Only admins get controls; the API enforces it too.
 */
export function GroupCategoriesContainer({ groupId }: { groupId: string }) {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('groups.categories');
  const tNotFound = useTranslations('groups.detail.notFound');
  const locale = useLocale();
  const language: CategoryLanguage = locale === 'en' ? 'en' : 'es';
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<ApiFailure>();
  const [editingId, setEditingId] = useState<string>();
  const [createFields, setCreateFields] = useState<GroupCategoryFieldErrors>();
  const [editFields, setEditFields] = useState<GroupCategoryFieldErrors>();
  // A new key remounts the create form, which clears what was typed after a success.
  const [createCount, setCreateCount] = useState(0);

  useEffect(() => {
    let active = true;
    void Promise.all([api.getGroup(groupId), api.listGroupCategories(groupId)]).then(
      ([group, categories]) => {
        if (!active) return;
        if (
          (!group.ok && group.code === 'UNAUTHENTICATED') ||
          (!categories.ok && categories.code === 'UNAUTHENTICATED')
        ) {
          router.replace('/sign-in');
        } else if (!group.ok) {
          setState(
            group.code === 'NOT_FOUND'
              ? { kind: 'not-found' }
              : { kind: 'failed', error: group.messageKey },
          );
        } else if (!categories.ok) {
          setState(
            categories.code === 'NOT_FOUND'
              ? { kind: 'not-found' }
              : { kind: 'failed', error: categories.messageKey },
          );
        } else {
          setState({
            kind: 'ready',
            groupName: group.data.name,
            isAdmin: group.data.role === 'admin',
            categories: categories.data,
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [api, groupId, router, attempt]);

  if (state.kind === 'not-found') {
    return (
      <EmptyState
        icon={<Users aria-hidden="true" />}
        title={tNotFound('title')}
        description={tNotFound('description')}
        action={
          <Link href="/groups" className={buttonVariants()}>
            {tNotFound('back')}
          </Link>
        }
      />
    );
  }

  if (state.kind !== 'ready') {
    return (
      <GroupsLoadStateView
        state={state}
        onRetry={() => {
          setState({ kind: 'loading' });
          setAttempt((current) => current + 1);
        }}
      />
    );
  }

  const { categories, isAdmin, groupName } = state;

  /** Runs one change; a 401 that could not be refreshed goes to sign-in. */
  async function run(
    action: () => Promise<ApiResult<GroupCategoryResponse>>,
    onSaved: (saved: GroupCategoryResponse) => void,
    onFailed: (failure: ApiFailure) => void,
  ) {
    setBusy(true);
    setIssue(undefined);
    const result = await action();
    setBusy(false);
    if (result.ok) onSaved(result.data);
    else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    else onFailed(result);
  }

  function replace(saved: GroupCategoryResponse) {
    setState((current) =>
      current.kind === 'ready'
        ? {
            ...current,
            categories: current.categories.map((item) => (item.id === saved.id ? saved : item)),
          }
        : current,
    );
  }

  function create(values: GroupCategoryFormValues) {
    setIssue(undefined);
    const built = buildGroupCategoryRequest(values);
    if (!built.request) {
      setCreateFields(built.fields);
      return;
    }
    setCreateFields(undefined);
    void run(
      () => api.createGroupCategory(groupId, built.request),
      (saved) => {
        setState((current) =>
          current.kind === 'ready'
            ? { ...current, categories: [...current.categories, saved] }
            : current,
        );
        setCreateCount((count) => count + 1);
      },
      (failure) => {
        if (failure.code === 'CATEGORY_NAME_TAKEN') {
          setCreateFields({ name: 'errors.categoryNameTaken' });
        } else setIssue(failure);
      },
    );
  }

  function save(id: string, values: GroupCategoryFormValues) {
    setIssue(undefined);
    const built = buildGroupCategoryRequest(values);
    if (!built.request) {
      setEditFields(built.fields);
      return;
    }
    setEditFields(undefined);
    void run(
      () => api.updateGroupCategory(groupId, id, built.request),
      (saved) => {
        replace(saved);
        setEditingId(undefined);
      },
      (failure) => {
        if (failure.code === 'CATEGORY_NAME_TAKEN') {
          setEditFields({ name: 'errors.categoryNameTaken' });
        } else setIssue(failure);
      },
    );
  }

  function setArchived(id: string, archived: boolean) {
    void run(() => api.updateGroupCategory(groupId, id, { archived }), replace, setIssue);
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('title')}
        description={groupName}
        actions={
          <Link
            href={`/groups/${encodeURIComponent(groupId)}`}
            className={buttonVariants({ variant: 'outline' })}
          >
            {t('back')}
          </Link>
        }
      />
      {issue ? <GroupIssue failure={issue} /> : null}
      {isAdmin ? null : <p className="text-small text-muted-foreground">{t('readOnly')}</p>}
      <GroupCategoriesList
        categories={categories}
        language={language}
        canManage={isAdmin}
        pending={busy}
        editingId={editingId}
        editFields={editFields}
        onStartEdit={(id) => {
          setEditFields(undefined);
          setEditingId(id);
        }}
        onCancelEdit={() => {
          setEditFields(undefined);
          setEditingId(undefined);
        }}
        onSaveEdit={save}
        onArchive={(id) => {
          setArchived(id, true);
        }}
        onRestore={(id) => {
          setArchived(id, false);
        }}
      />
      {isAdmin ? (
        <GroupCategoryForm
          key={createCount}
          pending={busy}
          fields={createFields}
          onSubmit={create}
        />
      ) : null}
    </div>
  );
}
