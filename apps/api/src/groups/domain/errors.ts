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

/** A settlement party is not an active member of the group (400, spec D4). */
export class GroupSettlementMemberInvalid extends AppError {
  constructor() {
    super('GROUP_SETTLEMENT_MEMBER_INVALID');
  }
}

/** The account is not a usable account of the caller in the cash currency (400, spec D5). */
export class GroupSettlementAccountInvalid extends AppError {
  constructor() {
    super('GROUP_SETTLEMENT_ACCOUNT_INVALID');
  }
}

/** One of the two legs is 0, so there is nothing to consolidate (400, spec D6). */
export class GroupSettlementNothingToConsolidate extends AppError {
  constructor() {
    super('GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE');
  }
}

/** The balances moved after the preview, so the legs sent are no longer current (409, spec D6). */
export class GroupSettlementStale extends AppError {
  constructor() {
    super('GROUP_SETTLEMENT_STALE');
  }
}

/**
 * The member cannot leave with a balance (409, spec D9). `details` carries the signed balance per
 * currency as `ARS` and `USD`, both always present.
 */
export class GroupMemberHasBalance extends AppError {
  readonly balances: Readonly<Record<'ARS' | 'USD', bigint>>;

  constructor(balances: Record<'ARS' | 'USD', bigint>) {
    super('GROUP_MEMBER_HAS_BALANCE', 'GROUP_MEMBER_HAS_BALANCE', undefined, {
      ARS: balances.ARS.toString(),
      USD: balances.USD.toString(),
    });
    this.balances = balances;
  }
}

/** The last admin cannot leave or be removed while other active members remain (409, spec D9). */
export class GroupLastAdmin extends AppError {
  constructor() {
    super('GROUP_LAST_ADMIN');
  }
}

/** No stored rate for the group's default rate type and no manual rate (same code as movements). */
export class SettlementRateRequired extends AppError {
  constructor() {
    super('RATE_REQUIRED');
  }
}
