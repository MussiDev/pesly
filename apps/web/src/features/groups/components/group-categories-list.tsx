'use client';

import {
  DEFAULT_CATEGORIES,
  displayCategoryName,
  type CategoryLanguage,
  type GroupCategoryResponse,
} from '@pesly/shared';
import { Archive, ArchiveRestore, Pencil, Tags } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/ui/empty-state';
import { IconAction } from '@/components/ui/icon-action';
import { ListRow } from '@/components/ui/list-row';
import { CategoryVisual } from '@/features/categories/components/category-visual';
import type { GroupCategoryFieldErrors, GroupCategoryFormValues } from '../category-request';
import { GroupCategoryForm } from './group-category-form';

export interface GroupCategoriesListProps {
  categories: readonly GroupCategoryResponse[];
  language: CategoryLanguage;
  /** Admins manage categories; everyone else gets the read-only list. */
  canManage: boolean;
  /** An action is in flight: the controls wait. */
  pending: boolean;
  editingId: string | undefined;
  editFields: GroupCategoryFieldErrors | undefined;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, values: GroupCategoryFormValues) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
}

const KNOWN_DEFAULTS = new Set<string>(DEFAULT_CATEGORIES.map((entry) => entry.key));

/**
 * The name to show: the group's own name, else the catalog name of the default key. A key this
 * build does not know (a newer catalog) shows the key instead of failing the whole list.
 */
export function groupCategoryLabel(
  category: GroupCategoryResponse,
  language: CategoryLanguage,
): string {
  if (category.name !== null) return category.name;
  const key = category.defaultKey ?? '';
  return KNOWN_DEFAULTS.has(key) ? displayCategoryName({ key, name: null }, language) : key;
}

/** The group's categories, archived ones marked; admins get edit and archive/restore controls. */
export function GroupCategoriesList(props: GroupCategoriesListProps) {
  const { categories, language, canManage, pending, editingId } = props;
  const t = useTranslations('groups.categories');
  const tCategories = useTranslations('categories');

  if (categories.length === 0) {
    return <EmptyState icon={<Tags aria-hidden />} title={t('empty')} />;
  }

  return (
    <ul
      aria-label={t('listLabel')}
      className="grid divide-y divide-border/70 rounded-card bg-card px-4 shadow-xs"
    >
      {categories.map((item) => {
        const label = groupCategoryLabel(item, language);
        const archived = item.archivedAt !== null;
        const editing = editingId === item.id;
        return (
          <li key={item.id} className="grid py-1">
            <ListRow
              leading={<CategoryVisual icon={item.icon} color={item.color} />}
              title={<span className="break-words whitespace-normal">{label}</span>}
              description={archived ? t('archivedBadge') : undefined}
              trailing={
                canManage && !editing ? (
                  <div className="flex items-center">
                    <IconAction
                      label={tCategories('actions.edit')}
                      subject={label}
                      icon={<Pencil aria-hidden />}
                      disabled={pending}
                      onClick={() => {
                        props.onStartEdit(item.id);
                      }}
                    />
                    {archived ? (
                      <IconAction
                        label={t('actions.restore')}
                        subject={label}
                        icon={<ArchiveRestore aria-hidden />}
                        disabled={pending}
                        onClick={() => {
                          props.onRestore(item.id);
                        }}
                      />
                    ) : (
                      <IconAction
                        label={tCategories('actions.archive')}
                        subject={label}
                        icon={<Archive aria-hidden />}
                        disabled={pending}
                        onClick={() => {
                          props.onArchive(item.id);
                        }}
                      />
                    )}
                  </div>
                ) : undefined
              }
            />
            {canManage && editing ? (
              <div className="pb-3">
                <GroupCategoryForm
                  category={item}
                  label={label}
                  pending={pending}
                  fields={props.editFields}
                  onSubmit={(values) => {
                    props.onSaveEdit(item.id, values);
                  }}
                  onCancel={props.onCancelEdit}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
