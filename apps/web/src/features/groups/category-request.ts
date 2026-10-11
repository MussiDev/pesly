import {
  categoryColorSchema,
  categoryIconSchema,
  categoryNameSchema,
  type CreateGroupCategoryRequest,
} from '@pesly/shared';
import {
  nameErrorMessage,
  type CategoryFieldMessage,
  type CategoryFieldName,
} from '@/features/categories/category-form-errors';

export type GroupCategoryFieldName = Extract<CategoryFieldName, 'name' | 'icon' | 'color'>;

export type GroupCategoryFieldErrors = Partial<
  Record<GroupCategoryFieldName, CategoryFieldMessage>
>;

/** Everything is text, as typed or picked. */
export interface GroupCategoryFormValues {
  name: string;
  icon: string;
  color: string;
}

export type GroupCategoryRequestResult =
  | { request: CreateGroupCategoryRequest; fields?: undefined }
  | { request?: undefined; fields: GroupCategoryFieldErrors };

/** The request (the same for create and edit), or the catalog path of what is wrong per field. */
export function buildGroupCategoryRequest(
  values: GroupCategoryFormValues,
): GroupCategoryRequestResult {
  const name = categoryNameSchema.safeParse(values.name);
  const icon = categoryIconSchema.safeParse(values.icon);
  const color = categoryColorSchema.safeParse(values.color);
  if (name.success && icon.success && color.success) {
    return { request: { name: name.data, icon: icon.data, color: color.data } };
  }

  const fields: GroupCategoryFieldErrors = {};
  if (!name.success) fields.name = nameErrorMessage(values.name);
  if (!icon.success) fields.icon = 'categories.errors.iconRequired';
  if (!color.success) fields.color = 'categories.errors.colorRequired';
  return { fields };
}
