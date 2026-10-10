import { z } from 'zod';
import { ACCOUNT_NAME_MAX_LENGTH, boundedNameSchema } from '../accounts/account';
import {
  categoryColorSchema,
  categoryIconSchema,
  categoryNameSchema,
} from '../categories/category';
import { rateTypeSchema } from '../rate-types';

/** A group name and a ghost member's display name share the account-name rules (spec D15). */
export const GROUP_NAME_MAX_LENGTH = ACCOUNT_NAME_MAX_LENGTH;

export const groupNameSchema = boundedNameSchema(GROUP_NAME_MAX_LENGTH);

export const GROUP_ROLES = ['admin', 'member'] as const;
export const groupRoleSchema = z.enum(GROUP_ROLES);
export type GroupRole = z.infer<typeof groupRoleSchema>;

/** 32 random bytes in base64url without padding. */
export const GROUP_TOKEN_LENGTH = 43;
export const groupTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, {
  message: 'Must be a 43-character base64url token',
});

const atLeastOne = (value: object): boolean => Object.keys(value).length > 0;

/** `POST /groups`. */
export const createGroupRequestSchema = z.strictObject({
  name: groupNameSchema,
  defaultRateType: rateTypeSchema,
});

export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;

/** `PATCH /groups/:id`: only the default rate type; a group cannot be renamed (spec D15). */
export const updateGroupRequestSchema = z.strictObject({ defaultRateType: rateTypeSchema });

export type UpdateGroupRequest = z.infer<typeof updateGroupRequestSchema>;

/** `POST /groups/:id/ghost-members`. */
export const addGhostMemberRequestSchema = z.strictObject({ displayName: groupNameSchema });

export type AddGhostMemberRequest = z.infer<typeof addGhostMemberRequestSchema>;

/** `POST /groups/join`. */
export const joinGroupRequestSchema = z.strictObject({ token: groupTokenSchema });

export type JoinGroupRequest = z.infer<typeof joinGroupRequestSchema>;

/** `POST /groups/claim`. */
export const claimGhostRequestSchema = z.strictObject({ token: groupTokenSchema });

export type ClaimGhostRequest = z.infer<typeof claimGhostRequestSchema>;

export const groupIdParamsSchema = z.object({ id: z.uuid() });

export type GroupIdParams = z.infer<typeof groupIdParamsSchema>;

export const groupMemberParamsSchema = z.object({ id: z.uuid(), memberId: z.uuid() });

export type GroupMemberParams = z.infer<typeof groupMemberParamsSchema>;

export const groupCategoryParamsSchema = z.object({ id: z.uuid(), categoryId: z.uuid() });

export type GroupCategoryParams = z.infer<typeof groupCategoryParamsSchema>;

/** `POST /groups/:id/categories`. */
export const createGroupCategoryRequestSchema = z.strictObject({
  name: categoryNameSchema,
  icon: categoryIconSchema,
  color: categoryColorSchema,
});

export type CreateGroupCategoryRequest = z.infer<typeof createGroupCategoryRequestSchema>;

/** `PATCH /groups/:id/categories/:categoryId`. */
export const updateGroupCategoryRequestSchema = z
  .strictObject({
    name: categoryNameSchema.optional(),
    icon: categoryIconSchema.optional(),
    color: categoryColorSchema.optional(),
    archived: z.boolean().optional(),
  })
  .refine(atLeastOne, { message: 'At least one field is required' });

export type UpdateGroupCategoryRequest = z.infer<typeof updateGroupCategoryRequestSchema>;

export const groupResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  defaultRateType: rateTypeSchema,
  role: groupRoleSchema,
  memberCount: z.number().int().min(0),
  createdAt: z.iso.datetime(),
});

export type GroupResponse = z.infer<typeof groupResponseSchema>;

/**
 * `displayName` is the user's profile name for a registered member (null only when the user has
 * none) and the stored name for a ghost.
 */
export const groupMemberResponseSchema = z.object({
  id: z.string(),
  displayName: z.string().nullable(),
  isGhost: z.boolean(),
  role: groupRoleSchema,
  joinedAt: z.iso.datetime(),
});

export type GroupMemberResponse = z.infer<typeof groupMemberResponseSchema>;

export const groupDetailResponseSchema = groupResponseSchema.extend({
  members: z.array(groupMemberResponseSchema),
});

export type GroupDetailResponse = z.infer<typeof groupDetailResponseSchema>;

export const invitationResponseSchema = z.object({
  token: groupTokenSchema,
  expiresAt: z.iso.datetime(),
});

export type InvitationResponse = z.infer<typeof invitationResponseSchema>;

export const claimLinkResponseSchema = z.object({ token: groupTokenSchema });

export type ClaimLinkResponse = z.infer<typeof claimLinkResponseSchema>;

export const groupCategoryResponseSchema = z.object({
  id: z.string(),
  defaultKey: z.string().nullable(),
  name: z.string().nullable(),
  icon: categoryIconSchema,
  color: categoryColorSchema,
  archivedAt: z.iso.datetime().nullable(),
});

export type GroupCategoryResponse = z.infer<typeof groupCategoryResponseSchema>;
