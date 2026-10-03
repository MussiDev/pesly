'use client';

import {
  CATEGORY_KINDS,
  CATEGORY_NAME_MAX_LENGTH,
  type CategoryKind,
  type CategoryLanguage,
  type CategoryResponse,
} from '@pesly/shared';
import { CircleAlert, Tags } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, type SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { ListRow } from '@/components/ui/list-row';
import { FormAlert } from '@/features/auth/components/form-alert';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { readField } from '@/features/auth/read-field';
import { categoryLabel, compareCategories } from '../category-display';
import type { CategoryFieldMessage } from '../category-form-errors';
import { CategoryField } from './category-field';
import { NEW_CATEGORY_NAME_ID } from './category-form';
import { ColorPicker, IconPicker } from './category-pickers';
import { CategoryVisual } from './category-visual';

/** What the inline edit submits: the raw name and the picked icon and color. */
export interface CategoryEditValues {
  name: string;
  icon: string;
  color: string;
}

export interface CategoryListProps {
  /** The categories of the current view (active or archived), in any order. */
  categories: readonly CategoryResponse[];
  language: CategoryLanguage;
  showArchived: boolean;
  /** An action is in flight: the controls wait. */
  pending: boolean;
  editingId: string | undefined;
  confirmingDeleteId: string | undefined;
  /** The API refused to delete this category because it is in use. */
  blockedDeleteId: string | undefined;
  editError: CategoryFieldMessage | undefined;
  actionError: ErrorMessageKey | undefined;
  onToggleArchived: () => void;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, values: CategoryEditValues) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onAskDelete: (id: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (id: string) => void;
}

interface EditFormProps {
  category: CategoryResponse;
  label: string;
  pending: boolean;
  error: CategoryFieldMessage | undefined;
  onSubmit: (values: CategoryEditValues) => void;
  onCancel: () => void;
}

function EditForm({ category, label, pending, error, onSubmit, onCancel }: EditFormProps) {
  const t = useTranslations('categories');
  const tAll = useTranslations();
  const messageId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSubmit({
      name: readField(form, 'name'),
      icon: readField(form, 'icon'),
      color: readField(form, 'color'),
    });
  }

  return (
    <form className="grid gap-3 pb-3" noValidate onSubmit={handleSubmit}>
      <div className="grid gap-2">
        <Input
          ref={inputRef}
          name="name"
          type="text"
          autoComplete="off"
          defaultValue={label}
          aria-label={t('actions.editField', { name: label })}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? messageId : undefined}
        />
        {error ? (
          <p id={messageId} className="text-small text-destructive">
            {tAll(error, { max: CATEGORY_NAME_MAX_LENGTH })}
          </p>
        ) : null}
      </div>
      <CategoryField label={t('fields.icon')} error={undefined} group>
        {(control) => <IconPicker control={control} defaultValue={category.icon} />}
      </CategoryField>
      <CategoryField label={t('fields.color')} error={undefined} group>
        {(control) => <ColorPicker control={control} defaultValue={category.color} />}
      </CategoryField>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t('actions.save')}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onCancel}>
          {t('actions.cancel')}
        </Button>
      </div>
    </form>
  );
}

/**
 * A live region is mounted empty and filled afterwards: many screen readers skip content that is
 * already there when the region appears.
 */
function AnnouncedText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.textContent = text;
  }, [text]);
  return <p ref={ref} role="status" className="text-small" />;
}

function focusNewCategory() {
  document.getElementById(NEW_CATEGORY_NAME_ID)?.focus();
}

/** Expense and income sections, each category with its subcategories and the row actions. */
export function CategoryList(props: CategoryListProps) {
  const { categories, language, showArchived, pending, editingId, confirmingDeleteId } = props;
  const t = useTranslations('categories');
  const tErrors = useTranslations('errors');
  const sectionId = useId();

  const ids = new Set(categories.map((item) => item.id));
  const childrenOf = new Map<string, CategoryResponse[]>();
  for (const item of categories) {
    if (item.parentId !== null && ids.has(item.parentId)) {
      childrenOf.set(item.parentId, [...(childrenOf.get(item.parentId) ?? []), item]);
    }
  }
  // A category whose parent is not in this view (an archived subcategory of an active parent, or
  // a subcategory of an archived parent) is listed as a root so it stays reachable.
  const roots = (kind: CategoryKind) =>
    categories
      .filter((item) => item.kind === kind && (item.parentId === null || !ids.has(item.parentId)))
      .sort(compareCategories);

  function renderRow(item: CategoryResponse, isChild: boolean) {
    const label = categoryLabel(item, language);
    const children = (childrenOf.get(item.id) ?? []).sort(compareCategories);
    return (
      <li key={item.id} aria-label={label} className={isChild ? 'grid' : 'grid py-1'}>
        <ListRow
          leading={<CategoryVisual icon={item.icon} color={item.color} />}
          title={<span className="break-words whitespace-normal">{label}</span>}
        />
        {editingId === item.id ? (
          <EditForm
            category={item}
            label={label}
            pending={pending}
            error={props.editError}
            onSubmit={(values) => {
              props.onSaveEdit(item.id, values);
            }}
            onCancel={props.onCancelEdit}
          />
        ) : confirmingDeleteId === item.id ? (
          <div className="grid gap-2 pb-2">
            <AnnouncedText text={t('actions.confirmDelete', { name: label })} />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => {
                  props.onConfirmDelete(item.id);
                }}
              >
                {t('actions.confirmDeleteYes')}
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={props.onCancelDelete}>
                {t('actions.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {props.blockedDeleteId === item.id ? (
              <Alert variant="destructive">
                <CircleAlert aria-hidden />
                <AlertDescription>
                  {tErrors('categoryInUse')}
                  {item.archived ? null : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        props.onArchive(item.id);
                      }}
                    >
                      {t('actions.archiveInstead')}
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-2 pb-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  props.onStartEdit(item.id);
                }}
              >
                {t('actions.edit')}
                <span className="sr-only"> {label}</span>
              </Button>
              {item.archived ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    props.onUnarchive(item.id);
                  }}
                >
                  {t('actions.unarchive')}
                  <span className="sr-only"> {label}</span>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    props.onArchive(item.id);
                  }}
                >
                  {t('actions.archive')}
                  <span className="sr-only"> {label}</span>
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  props.onAskDelete(item.id);
                }}
              >
                {t('actions.delete')}
                <span className="sr-only"> {label}</span>
              </Button>
            </div>
          </>
        )}
        {children.length > 0 ? (
          <ul
            aria-label={t('list.subcategories', { name: label })}
            className="ml-4 grid divide-y border-l pl-3"
          >
            {children.map((child) => renderRow(child, true))}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <section className="grid gap-4">
      <h2 className="text-heading">
        {showArchived ? t('list.archivedTitle') : t('list.activeTitle')}
      </h2>
      <FormAlert error={props.actionError} />
      <label className="flex items-center gap-3 text-small">
        <Checkbox checked={showArchived} disabled={pending} onChange={props.onToggleArchived} />
        {t('list.showArchived')}
      </label>
      {categories.length === 0 ? (
        <EmptyState
          title={showArchived ? t('list.emptyArchived') : t('list.empty')}
          icon={<Tags aria-hidden />}
          action={
            showArchived ? (
              <Button type="button" variant="outline" onClick={props.onToggleArchived}>
                {t('list.emptyArchivedAction')}
              </Button>
            ) : (
              <Button type="button" onClick={focusNewCategory}>
                {t('list.emptyAction')}
              </Button>
            )
          }
        />
      ) : (
        CATEGORY_KINDS.map((kind) => {
          const rows = roots(kind);
          return (
            <section key={kind} aria-labelledby={`${sectionId}-${kind}`} className="grid gap-2">
              <h3
                id={`${sectionId}-${kind}`}
                className="text-caption text-muted-foreground uppercase"
              >
                {t(`sections.${kind}`)}
              </h3>
              {rows.length === 0 ? (
                <p className="text-small text-muted-foreground">{t('list.emptySection')}</p>
              ) : (
                <ul className="grid divide-y rounded-xl border bg-card px-3">
                  {rows.map((item) => renderRow(item, false))}
                </ul>
              )}
            </section>
          );
        })
      )}
    </section>
  );
}
