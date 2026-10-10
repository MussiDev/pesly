import { AppError } from '@pesly/shared';

/** A non-admin member tried an admin-only action (403, spec D1). */
export class GroupAdminRequired extends AppError {
  constructor() {
    super('GROUP_ADMIN_REQUIRED');
  }
}

/** The user already belongs to the group (spec D7). */
export class GroupAlreadyMember extends AppError {
  constructor() {
    super('GROUP_ALREADY_MEMBER');
  }
}

/** The group already has 50 members, ghosts included (spec D6). */
export class GroupMemberLimitReached extends AppError {
  constructor() {
    super('GROUP_MEMBER_LIMIT_REACHED');
  }
}

/** A ghost member cannot be made admin (spec D2). */
export class GroupMemberNotRegistered extends AppError {
  constructor() {
    super('GROUP_MEMBER_NOT_REGISTERED');
  }
}

/** Unknown, expired or used token; one answer for all so the cases cannot be told apart (spec D4). */
export class TokenInvalid extends AppError {
  constructor() {
    super('TOKEN_INVALID');
  }
}

/** Another category of the group already answers to this name, in either language (spec D8). */
export class GroupCategoryNameTaken extends AppError {
  constructor() {
    super('CATEGORY_NAME_TAKEN');
  }
}
