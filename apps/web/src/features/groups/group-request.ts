import {
  GROUP_NAME_MAX_LENGTH,
  RATE_TYPES,
  groupNameSchema,
  type CreateGroupRequest,
  type RateType,
} from '@pesly/shared';

export type GroupFieldName = 'name' | 'defaultRateType';

export type GroupFieldMessage =
  | 'groups.list.errors.nameRequired'
  | 'groups.list.errors.nameTooLong'
  | 'groups.list.errors.nameInvalid'
  | 'groups.list.errors.rateTypeRequired';

export type GroupFieldErrors = Partial<Record<GroupFieldName, GroupFieldMessage>>;

/** Everything is text, as typed or selected. */
export interface GroupFormValues {
  name: string;
  defaultRateType: string;
}

export type GroupRequestResult =
  | { request: CreateGroupRequest; fields?: undefined }
  | { request?: undefined; fields: GroupFieldErrors };

function isRateType(value: string): value is RateType {
  return (RATE_TYPES as readonly string[]).includes(value);
}

/** The create request, or the catalog path of what is wrong next to each field. */
export function buildGroupRequest(values: GroupFormValues): GroupRequestResult {
  const fields: GroupFieldErrors = {};
  const length = Array.from(values.name.trim()).length;
  const name = groupNameSchema.safeParse(values.name);
  if (length < 1) fields.name = 'groups.list.errors.nameRequired';
  else if (length > GROUP_NAME_MAX_LENGTH) fields.name = 'groups.list.errors.nameTooLong';
  else if (!name.success) fields.name = 'groups.list.errors.nameInvalid';

  const rateType = values.defaultRateType;
  if (!isRateType(rateType)) fields.defaultRateType = 'groups.list.errors.rateTypeRequired';

  if (!name.success || fields.name !== undefined || !isRateType(rateType)) return { fields };
  return { request: { name: name.data, defaultRateType: rateType } };
}
