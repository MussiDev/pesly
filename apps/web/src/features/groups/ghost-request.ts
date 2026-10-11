import { GROUP_NAME_MAX_LENGTH, groupNameSchema, type AddGhostMemberRequest } from '@pesly/shared';

export type GhostNameMessage =
  | 'groups.invite.ghost.errors.nameRequired'
  | 'groups.invite.ghost.errors.nameTooLong'
  | 'groups.invite.ghost.errors.nameInvalid';

export type GhostRequestResult =
  | { request: AddGhostMemberRequest; error?: undefined }
  | { request?: undefined; error: GhostNameMessage };

/** The add-member request, or the catalog path of what is wrong with the name. */
export function buildGhostRequest(name: string): GhostRequestResult {
  const length = Array.from(name.trim()).length;
  if (length < 1) return { error: 'groups.invite.ghost.errors.nameRequired' };
  if (length > GROUP_NAME_MAX_LENGTH) return { error: 'groups.invite.ghost.errors.nameTooLong' };
  const parsed = groupNameSchema.safeParse(name);
  if (!parsed.success) return { error: 'groups.invite.ghost.errors.nameInvalid' };
  return { request: { displayName: parsed.data } };
}
