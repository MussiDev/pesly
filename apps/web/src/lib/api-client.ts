import {
  accountResponseSchema,
  categoryResponseSchema,
  dashboardResponseSchema,
  type DashboardResponse,
  errorResponseSchema,
  groupExpenseResponseSchema,
  groupExpensePageSchema,
  expenseOptionsResponseSchema,
  defaultSplitResponseSchema,
  defaultSplitRequestSchema,
  createGroupExpenseRequestSchema,
  personalSharesPageSchema,
  listGroupExpensesQuerySchema,
  groupExpenseSummaryQuerySchema,
  groupExpenseSummaryResponseSchema,
  type GroupExpenseSummaryQuery,
  type GroupExpenseSummaryResponse,
  type CreateGroupExpenseRequest,
  type DefaultSplitRequest,
  type DefaultSplitResponse,
  type ExpenseOptionsResponse,
  type GroupExpensePage,
  type ListGroupExpensesQuery,
  type PersonalSharesPage,
  type PersonalSharesQuery,
  groupRecordConflictSchema,
  groupResponseSchema,
  groupDetailResponseSchema,
  groupMemberResponseSchema,
  groupCategoryResponseSchema,
  invitationResponseSchema,
  claimLinkResponseSchema,
  type GroupResponse,
  type GroupDetailResponse,
  type GroupMemberResponse,
  type GroupCategoryResponse,
  type InvitationResponse,
  type ClaimLinkResponse,
  type CreateGroupRequest,
  type UpdateGroupRequest,
  type AddGhostMemberRequest,
  type CreateGroupCategoryRequest,
  type UpdateGroupCategoryRequest,
  settlementResponseSchema,
  settlementPageSchema,
  balancesResponseSchema,
  consolidationPreviewSchema,
  consolidationQuerySchema,
  createSettlementRequestSchema,
  type BalancesResponse,
  type ConsolidationPreview,
  type ConsolidationQuery,
  type CreateSettlementRequest,
  type SettlementPage,
  activityPageSchema,
  listActivityQuerySchema,
  type ActivityPage,
  listAccountsResponseSchema,
  setAccountBalanceResponseSchema,
  listCategoriesResponseSchema,
  addHoldingResponseSchema,
  importHoldingsResponseSchema,
  holdingResponseSchema,
  latestRatesResponseSchema,
  listMovementsResponseSchema,
  movementDetailResponseSchema,
  movementSummaryResponseSchema,
  type MovementSummaryResponse,
  sendMovementToGroupRequestSchema,
  sendMovementToGroupResponseSchema,
  linkPayerMovementRequestSchema,
  movementCandidatesResponseSchema,
  type LinkPayerMovementRequest,
  type MovementCandidatesResponse,
  type MovementDetailResponse,
  type SendMovementToGroupRequest,
  type SendMovementToGroupResponse,
  listTagsResponseSchema,
  movementResponseSchema,
  tagSuggestionsResponseSchema,
  portfolioListResponseSchema,
  portfolioResponseSchema,
  passwordResetConfirmResponseSchema,
  passwordResetResponseSchema,
  profileResponseSchema,
  refreshResponseSchema,
  registerResponseSchema,
  resendVerificationResponseSchema,
  secondFactorVerifyResponseSchema,
  sessionResponseSchema,
  signInResponseSchema,
  startDeletionReauthResponseSchema,
  twoFactorEnableResponseSchema,
  twoFactorSetupResponseSchema,
  twoFactorStatusResponseSchema,
  verifyEmailResponseSchema,
  type AccountResponse,
  type CategoryResponse,
  type createAccountRequestSchema,
  type createMovementRequestSchema,
  type updateMovementRequestSchema,
  type LatestRatesResponse,
  type ListMovementsQuery,
  type ListMovementsResponse,
  type ListTagsQuery,
  type ListTagsResponse,
  type TagSuggestionsQuery,
  type TagSuggestionsResponse,
  type MovementResponse,
  type CreateCategoryRequest,
  type DeleteUserRequest,
  type ErrorCode,
  type ListAccountsQuery,
  type ListAccountsResponse,
  type ListCategoriesQuery,
  type ListCategoriesResponse,
  type AddHoldingRequest,
  type AddHoldingResponse,
  type ImportHoldingsRequest,
  type ImportHoldingsResponse,
  type CreatePortfolioRequest,
  type HoldingResponse,
  type PortfolioListResponse,
  type PortfolioResponse,
  type SetPriceRequest,
  type UpdateHoldingRequest,
  type GroupExpenseResponse,
  type GroupRecordConflict,
  type SettlementResponse,
  type UpdateGroupExpenseRequest,
  type UpdateSettlementRequest,
  type PasswordResetConfirmRequest,
  type PasswordResetConfirmResponse,
  type PasswordResetRequest,
  type PasswordResetResponse,
  type ProfileResponse,
  type RegisterRequest,
  type RegisterResponse,
  type RenameAccountRequest,
  type SetAccountBalanceRequest,
  type SetAccountBalanceResponse,
  cardExpenseResponseSchema,
  statementImportResponseSchema,
  creditCardResponseSchema,
  listCreditCardsResponseSchema,
  installmentPurchaseResponseSchema,
  listInstallmentPurchasesResponseSchema,
  listStatementsResponseSchema,
  statementPaymentResponseSchema,
  statementResponseSchema,
  listRecurringPaymentsResponseSchema,
  recurringPaymentResponseSchema,
  upcomingResponseSchema,
  netWorthResponseSchema,
  expensesByCategoryResponseSchema,
  incomeExpensesResponseSchema,
  listNoticesResponseSchema,
  markAllReadResponseSchema,
  noticeSchema,
  type ListNoticesResponse,
  type MarkAllReadResponse,
  type Notice,
  type ConfirmOccurrence,
  type CreateRecurringPayment,
  type ListRecurringPaymentsResponse,
  type ExpensesByCategoryResponse,
  type IncomeExpensesResponse,
  type NetWorthResponse,
  type RecurringPaymentResponse,
  type UpcomingResponse,
  type UpdateRecurringPayment,
  type CardExpenseResponse,
  type CreateCardExpenseRequest,
  type CreateStatementImportRequest,
  type StatementImportResponse,
  type CreateInstallmentPurchaseRequest,
  type CreateStatementPaymentRequest,
  type StatementPaymentResponse,
  type InstallmentPurchaseResponse,
  type ListInstallmentPurchasesResponse,
  type CreateCreditCardRequest,
  type CreditCardResponse,
  type ListCreditCardsResponse,
  type ListStatementsResponse,
  type SetDebitAccountsRequest,
  type StatementResponse,
  type UpdateCreditCardRequest,
  type UpdateStatementRequest,
  createGoalEntryRequestSchema,
  createGoalRequestSchema,
  goalResponseSchema,
  listGoalEntriesQuerySchema,
  listGoalEntriesResponseSchema,
  listGoalsResponseSchema,
  recordGoalEntryResponseSchema,
  updateGoalRequestSchema,
  type CreateGoalEntryRequest,
  type CreateGoalRequest,
  type GoalResponse,
  type ListGoalEntriesQuery,
  type ListGoalEntriesResponse,
  type ListGoalsResponse,
  type RecordGoalEntryResponse,
  type UpdateGoalRequest,
  budgetResponseSchema,
  budgetSpendingListResponseSchema,
  budgetSpendingQuerySchema,
  budgetSpendingResponseSchema,
  createBudgetRequestSchema,
  updateBudgetRequestSchema,
  type BudgetResponse,
  type BudgetSpendingListResponse,
  type BudgetSpendingQuery,
  type BudgetSpendingResponse,
  type CreateBudgetRequest,
  type UpdateBudgetRequest,
  pushConfigResponseSchema,
  pushSubscriptionRequestSchema,
  pushSubscriptionResponseSchema,
  unsubscribeRequestSchema,
  type PushConfigResponse,
  type PushSubscriptionRequest,
  type PushSubscriptionResponse,
  type UnsubscribeRequest,
  type ResendVerificationResponse,
  type SecondFactorVerifyRequest,
  type SecondFactorVerifyResponse,
  type SessionResponse,
  type SignInRequest,
  type SignInResponse,
  type StartDeletionReauthResponse,
  type TwoFactorDisableRequest,
  type TwoFactorEnableRequest,
  type TwoFactorEnableResponse,
  type TwoFactorSetupResponse,
  type TwoFactorStatusResponse,
  type UpdateCategoryRequest,
  type UpdateProfileRequest,
  type VerifyEmailRequest,
  type VerifyEmailResponse,
} from '@pesly/shared';
import { z } from 'zod';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Keys of the `errors` namespace in the i18n catalogs; the API only ever sends codes. */
export type ApiErrorKey =
  | 'invalidCredentials'
  | 'passwordTooShort'
  | 'passwordBreached'
  | 'tokenInvalid'
  | 'retryLater'
  | 'network'
  | 'unexpected'
  | 'unauthenticated'
  | 'emailNotVerified'
  | 'validationFailed'
  | 'codeInvalid'
  | 'secondFactorExpired'
  | 'twoFactorAlreadyEnabled'
  | 'twoFactorNotEnabled'
  | 'twoFactorSetupRequired'
  | 'accountNameTaken'
  | 'accountHasMovements'
  | 'categoryNameTaken'
  | 'categoryInUse'
  | 'categoryNestingTooDeep'
  | 'categoryParentKindMismatch'
  | 'reauthenticationRequired'
  | 'accountArchived'
  | 'movementDateInFuture'
  | 'rateRequired'
  | 'movementCategoryKindMismatch'
  | 'categoryArchived'
  | 'movementSameAccount'
  | 'movementCurrencyMismatch'
  | 'exchangeSameCurrency'
  | 'impliedRateOutOfRange'
  | 'movementTypeImmutable'
  | 'accountLinkedToCard'
  | 'debitAccountCurrencyMismatch'
  | 'debitAccountIsCardAccount'
  | 'cardHasMovements'
  | 'statementClosed'
  | 'recurringOccurrenceNotPending'
  | 'recurringLimitReached'
  | 'budgetLimitReached'
  | 'budgetCategoryKindInvalid'
  | 'budgetMonthInFuture'
  | 'groupAdminRequired'
  | 'groupAlreadyMember'
  | 'groupMemberLimitReached'
  | 'groupMemberNotRegistered'
  | 'groupSplitPercentageInvalid'
  | 'groupSplitAmountMismatch'
  | 'groupSplitMemberInvalid'
  | 'groupExpenseCategoryInvalid'
  | 'groupPayerAccountInvalid'
  | 'groupSettlementMemberInvalid'
  | 'groupSettlementAccountInvalid'
  | 'groupSettlementNothingToConsolidate'
  | 'groupMemberHasBalance'
  | 'groupLastAdmin'
  | 'groupSettlementStale'
  | 'groupRecordEditForbidden'
  | 'groupRecordFormerMember'
  | 'groupRecordConflict'
  | 'groupSettlementConsolidated'
  | 'groupActivityLogImmutable'
  | 'goalAccountCurrencyMismatch'
  | 'goalLinkedToAccount'
  | 'goalWithdrawalExceedsProgress'
  | 'goalProgressTooLarge'
  | 'goalLimitReached'
  | 'accountLinkedToGoal'
  | 'groupMovementNotExpense'
  | 'groupMovementAlreadySent'
  | 'groupMovementChanged'
  | 'groupPayerOnly'
  | 'groupExpenseAlreadyLinked'
  | 'groupMovementMismatch'
  | 'movementLockedByGroupExpense'
  | 'offlineNoCopy'
  | 'offlineSaveFailed';

/** `NETWORK`: the request never got an HTTP answer (offline, DNS, CORS, aborted). */
export type ApiFailureCode = ErrorCode | 'NETWORK';

export interface ApiFailure {
  ok: false;
  code: ApiFailureCode;
  messageKey: ApiErrorKey;
  /** Names of the invalid request fields, present only when the API sent them. */
  fields?: string[];
  /** Whole seconds to wait, read from the `Retry-After` header; absent when it was missing or unusable. */
  retryAfterSeconds?: number;
  /** Only on a `GROUP_RECORD_CONFLICT`: the record as the server holds it now. */
  current?: GroupRecordConflict['current'];
  /** Only on a `GROUP_MEMBER_HAS_BALANCE`: what the member owes (negative) or is owed, per currency. */
  balances?: GroupBalances;
}

/** Signed integer strings in minor units, both always present. */
export interface GroupBalances {
  ARS: string;
  USD: string;
}

/** The outcome of a group change the server refused because the record changed meanwhile (D3). */
export type ApiGroupConflict = ApiFailure & {
  code: 'GROUP_RECORD_CONFLICT';
  current: GroupRecordConflict['current'];
};

export function isGroupRecordConflict<T>(result: ApiResult<T>): result is ApiGroupConflict {
  return !result.ok && result.code === 'GROUP_RECORD_CONFLICT' && result.current !== undefined;
}

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

const MESSAGE_KEY_BY_CODE: Record<ApiFailureCode, ApiErrorKey> = {
  INVALID_CREDENTIALS: 'invalidCredentials',
  PASSWORD_TOO_SHORT: 'passwordTooShort',
  PASSWORD_BREACHED: 'passwordBreached',
  TOKEN_INVALID: 'tokenInvalid',
  RATE_LIMITED: 'retryLater',
  PASSWORD_CHECK_UNAVAILABLE: 'retryLater',
  NETWORK: 'network',
  UNAUTHENTICATED: 'unauthenticated',
  EMAIL_NOT_VERIFIED: 'emailNotVerified',
  VALIDATION_FAILED: 'validationFailed',
  NOT_FOUND: 'unexpected',
  INTERNAL: 'unexpected',
  TOTP_INVALID: 'codeInvalid',
  TWO_FACTOR_ALREADY_ENABLED: 'twoFactorAlreadyEnabled',
  TWO_FACTOR_NOT_ENABLED: 'twoFactorNotEnabled',
  TWO_FACTOR_SETUP_REQUIRED: 'twoFactorSetupRequired',
  TWO_FACTOR_UNAVAILABLE: 'retryLater',
  SECOND_FACTOR_INVALID: 'codeInvalid',
  SECOND_FACTOR_EXPIRED: 'secondFactorExpired',
  ACCOUNT_NAME_TAKEN: 'accountNameTaken',
  ACCOUNT_HAS_MOVEMENTS: 'accountHasMovements',
  CATEGORY_NAME_TAKEN: 'categoryNameTaken',
  CATEGORY_IN_USE: 'categoryInUse',
  CATEGORY_NESTING_TOO_DEEP: 'categoryNestingTooDeep',
  CATEGORY_PARENT_KIND_MISMATCH: 'categoryParentKindMismatch',
  REAUTHENTICATION_REQUIRED: 'reauthenticationRequired',
  ACCOUNT_ARCHIVED: 'accountArchived',
  MOVEMENT_DATE_IN_FUTURE: 'movementDateInFuture',
  RATE_REQUIRED: 'rateRequired',
  MOVEMENT_CATEGORY_KIND_MISMATCH: 'movementCategoryKindMismatch',
  CATEGORY_ARCHIVED: 'categoryArchived',
  MOVEMENT_SAME_ACCOUNT: 'movementSameAccount',
  MOVEMENT_CURRENCY_MISMATCH: 'movementCurrencyMismatch',
  EXCHANGE_SAME_CURRENCY: 'exchangeSameCurrency',
  IMPLIED_RATE_OUT_OF_RANGE: 'impliedRateOutOfRange',
  MOVEMENT_TYPE_IMMUTABLE: 'movementTypeImmutable',
  ACCOUNT_LINKED_TO_CARD: 'accountLinkedToCard',
  DEBIT_ACCOUNT_CURRENCY_MISMATCH: 'debitAccountCurrencyMismatch',
  DEBIT_ACCOUNT_IS_CARD_ACCOUNT: 'debitAccountIsCardAccount',
  CARD_HAS_MOVEMENTS: 'cardHasMovements',
  STATEMENT_CLOSED: 'statementClosed',
  RECURRING_OCCURRENCE_NOT_PENDING: 'recurringOccurrenceNotPending',
  RECURRING_LIMIT_REACHED: 'recurringLimitReached',
  BUDGET_LIMIT_REACHED: 'budgetLimitReached',
  BUDGET_CATEGORY_KIND_INVALID: 'budgetCategoryKindInvalid',
  BUDGET_MONTH_IN_FUTURE: 'budgetMonthInFuture',
  GROUP_ADMIN_REQUIRED: 'groupAdminRequired',
  GROUP_ALREADY_MEMBER: 'groupAlreadyMember',
  GROUP_MEMBER_LIMIT_REACHED: 'groupMemberLimitReached',
  GROUP_MEMBER_NOT_REGISTERED: 'groupMemberNotRegistered',
  GROUP_SPLIT_PERCENTAGE_INVALID: 'groupSplitPercentageInvalid',
  GROUP_SPLIT_AMOUNT_MISMATCH: 'groupSplitAmountMismatch',
  GROUP_SPLIT_MEMBER_INVALID: 'groupSplitMemberInvalid',
  GROUP_EXPENSE_CATEGORY_INVALID: 'groupExpenseCategoryInvalid',
  GROUP_PAYER_ACCOUNT_INVALID: 'groupPayerAccountInvalid',
  GROUP_SETTLEMENT_MEMBER_INVALID: 'groupSettlementMemberInvalid',
  GROUP_SETTLEMENT_ACCOUNT_INVALID: 'groupSettlementAccountInvalid',
  GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE: 'groupSettlementNothingToConsolidate',
  GROUP_MEMBER_HAS_BALANCE: 'groupMemberHasBalance',
  GROUP_LAST_ADMIN: 'groupLastAdmin',
  GROUP_SETTLEMENT_STALE: 'groupSettlementStale',
  GROUP_RECORD_EDIT_FORBIDDEN: 'groupRecordEditForbidden',
  GROUP_RECORD_FORMER_MEMBER: 'groupRecordFormerMember',
  GROUP_RECORD_CONFLICT: 'groupRecordConflict',
  GROUP_SETTLEMENT_CONSOLIDATED: 'groupSettlementConsolidated',
  GROUP_ACTIVITY_LOG_IMMUTABLE: 'groupActivityLogImmutable',
  GOAL_ACCOUNT_CURRENCY_MISMATCH: 'goalAccountCurrencyMismatch',
  GOAL_LINKED_TO_ACCOUNT: 'goalLinkedToAccount',
  GOAL_WITHDRAWAL_EXCEEDS_PROGRESS: 'goalWithdrawalExceedsProgress',
  GOAL_PROGRESS_TOO_LARGE: 'goalProgressTooLarge',
  GOAL_LIMIT_REACHED: 'goalLimitReached',
  ACCOUNT_LINKED_TO_GOAL: 'accountLinkedToGoal',
  GROUP_MOVEMENT_NOT_EXPENSE: 'groupMovementNotExpense',
  GROUP_MOVEMENT_ALREADY_SENT: 'groupMovementAlreadySent',
  GROUP_MOVEMENT_CHANGED: 'groupMovementChanged',
  GROUP_PAYER_ONLY: 'groupPayerOnly',
  GROUP_EXPENSE_ALREADY_LINKED: 'groupExpenseAlreadyLinked',
  GROUP_MOVEMENT_MISMATCH: 'groupMovementMismatch',
  MOVEMENT_LOCKED_BY_GROUP_EXPENSE: 'movementLockedByGroupExpense',
};

/**
 * The message of an error code kept on the device (a rejected queued change). The code is read
 * back from storage, so anything that is not a known code is the generic message.
 */
export function messageKeyOf(code: string): ApiErrorKey {
  return Object.hasOwn(MESSAGE_KEY_BY_CODE, code)
    ? MESSAGE_KEY_BY_CODE[code as ApiFailureCode]
    : 'unexpected';
}

/** `null` when the id is not a plain path segment: '.' and '..' survive encoding and would be normalized. */
function resourcePath(collection: string, id: string): string | null {
  if (id === '' || id === '.' || id === '..') return null;
  return `/${collection}/${encodeURIComponent(id)}`;
}

function failure(code: ApiFailureCode): ApiFailure {
  return { ok: false, code, messageKey: MESSAGE_KEY_BY_CODE[code] };
}

/** Only a 409 whose `details.current` is a real group record is a conflict; anything else is not. */
function isConflictCode(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'code' in payload &&
    payload.code === 'GROUP_RECORD_CONFLICT'
  );
}

function readGroupConflict(payload: unknown): ApiGroupConflict | undefined {
  if (!isConflictCode(payload) || typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const details = 'details' in payload ? payload.details : undefined;
  const parsed = groupRecordConflictSchema.safeParse(details);
  if (!parsed.success) return undefined;
  return {
    ...failure('GROUP_RECORD_CONFLICT'),
    code: 'GROUP_RECORD_CONFLICT',
    current: parsed.data.current,
  };
}

/** Signed minor-unit amounts as the API sends them; read only when both are integer strings. */
function readBalances(details: Record<string, string> | undefined): GroupBalances | undefined {
  const ars = details?.ARS;
  const usd = details?.USD;
  if (ars === undefined || usd === undefined) return undefined;
  const integer = /^-?\d+$/;
  return integer.test(ars) && integer.test(usd) ? { ARS: ars, USD: usd } : undefined;
}

const GROUP_TOKEN_CLIENT_MAX = 200;

const groupListResponseSchema = z.array(groupResponseSchema);
const groupCategoryListResponseSchema = z.array(groupCategoryResponseSchema);

/** Required by the API's origin guard on state-changing requests (CSRF defence in depth). */
const REQUESTED_WITH = 'argent';

/** Web Locks name shared by every tab of the origin. */
const REFRESH_LOCK = 'argent-refresh';

interface RequestOptions<T> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  /** `null` for answers without a body (204). */
  response: z.ZodType<T> | null;
  /** Session-bound calls try `POST /auth/refresh` once when the access token is refused. */
  refreshOnUnauthenticated?: boolean;
}

/** What the containers send to create an account; the opening balance defaults to "0" server-side. */
export type CreateAccountInput = z.input<typeof createAccountRequestSchema>;

/** Only `name` is renameable; type and currency are immutable. */
export type RenameAccountInput = Pick<RenameAccountRequest, 'name'>;

/**
 * The target balance as a minor-units integer string, an optional note and, when the user has 2FA
 * on, the second-factor code. The difference is never sent: the server computes it.
 */
export type SetAccountBalanceInput = SetAccountBalanceRequest;

export type ListAccountsParams = Partial<Pick<ListAccountsQuery, 'archived' | 'limit' | 'offset'>>;

/** What the containers send to create a category: the validated body of `POST /categories`. */
export type CreateCategoryInput = CreateCategoryRequest;

/** Only `name`, `icon` and `color` change; `kind` and `parentId` are immutable. */
export type UpdateCategoryInput = Pick<UpdateCategoryRequest, 'name' | 'icon' | 'color'>;

export type ListCategoriesParams = Partial<
  Pick<ListCategoriesQuery, 'kind' | 'archived' | 'limit' | 'offset'>
>;

/** What the entry screen sends to create a movement: the body of `POST /movements`. */
export type CreateMovementInput = z.input<typeof createMovementRequestSchema>;

/** What the edit screen sends: the body of `PUT /movements/:id`; the rate may also be `keep`. */
export type UpdateMovementInput = z.input<typeof updateMovementRequestSchema>;

/** Paging and the optional filters of `GET /movements`; whatever is undefined is not sent. */
export type ListMovementsParams = Partial<
  Pick<
    ListMovementsQuery,
    | 'limit'
    | 'offset'
    | 'accountId'
    | 'categoryId'
    | 'from'
    | 'to'
    | 'type'
    | 'tag'
    | 'hideAdjustments'
  >
>;

/** Filters of the two flow reports; whatever is undefined is not sent. */
export interface ReportFlowParams {
  from?: string | undefined;
  to?: string | undefined;
  accountId?: string | undefined;
  tag?: string | undefined;
}

/** Net worth takes the date range only. */
export interface NetWorthParams {
  from?: string | undefined;
  to?: string | undefined;
}

/** `?key=value` for the defined keys, in the given order; empty when none is defined. */
function reportQueryString(
  params: ReportFlowParams | undefined,
  keys: readonly (keyof ReportFlowParams)[],
): string {
  const query = new URLSearchParams();
  for (const key of keys) {
    const value = params?.[key];
    if (value !== undefined) query.set(key, value);
  }
  const text = query.toString();
  return text === '' ? '' : `?${text}`;
}

export type ListTagsParams = Pick<TagSuggestionsQuery, 'prefix'> &
  Partial<Pick<TagSuggestionsQuery, 'limit'>>;

/** One page of `GET /tags/all`; whatever is undefined is not sent. */
export type ListAllTagsParams = Partial<ListTagsQuery>;

const LIST_MOVEMENTS_QUERY_KEYS = [
  'limit',
  'offset',
  'accountId',
  'categoryId',
  'from',
  'to',
  'type',
  'tag',
  'hideAdjustments',
] as const satisfies readonly (keyof ListMovementsParams)[];

/** The filters of `GET /movements/summary`: the list filters without paging. */
export type MovementSummaryParams = Omit<ListMovementsParams, 'limit' | 'offset'>;

const MOVEMENT_SUMMARY_QUERY_KEYS = LIST_MOVEMENTS_QUERY_KEYS.filter(
  (key): key is Exclude<(typeof LIST_MOVEMENTS_QUERY_KEYS)[number], 'limit' | 'offset'> =>
    key !== 'limit' && key !== 'offset',
);

/** Only a positive whole number of seconds is a usable wait; HTTP dates and junk are ignored. */
function readRetryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get('Retry-After');
  if (header === null || !/^\d{1,9}$/.test(header)) return undefined;
  const seconds = Number.parseInt(header, 10);
  return seconds > 0 ? seconds : undefined;
}

export interface ApiClientOptions {
  /** The API origin, e.g. `https://api.argent.app`. */
  baseUrl: string;
  fetch?: FetchLike;
}

export interface ApiClient {
  register(body: RegisterRequest): Promise<ApiResult<RegisterResponse>>;
  verifyEmail(body: VerifyEmailRequest): Promise<ApiResult<VerifyEmailResponse>>;
  resendVerification(): Promise<ApiResult<ResendVerificationResponse>>;
  signIn(body: SignInRequest): Promise<ApiResult<SignInResponse>>;
  signOut(): Promise<ApiResult<undefined>>;
  getSession(): Promise<ApiResult<SessionResponse>>;
  requestPasswordReset(body: PasswordResetRequest): Promise<ApiResult<PasswordResetResponse>>;
  confirmPasswordReset(
    body: PasswordResetConfirmRequest,
  ): Promise<ApiResult<PasswordResetConfirmResponse>>;
  getTwoFactorStatus(): Promise<ApiResult<TwoFactorStatusResponse>>;
  startTwoFactorSetup(): Promise<ApiResult<TwoFactorSetupResponse>>;
  /** Answers with new session cookies: every other session of the user ends (FR-05). */
  enableTwoFactor(body: TwoFactorEnableRequest): Promise<ApiResult<TwoFactorEnableResponse>>;
  /** Answers with new session cookies: every other session of the user ends (FR-05). */
  disableTwoFactor(body: TwoFactorDisableRequest): Promise<ApiResult<undefined>>;
  /** The second step of a sign-in; the challenge travels in its own cookie, not a session. */
  verifySecondFactor(
    body: SecondFactorVerifyRequest,
  ): Promise<ApiResult<SecondFactorVerifyResponse>>;
  listAccounts(query: ListAccountsParams): Promise<ApiResult<ListAccountsResponse>>;
  createAccount(body: CreateAccountInput): Promise<ApiResult<AccountResponse>>;
  getAccount(id: string): Promise<ApiResult<AccountResponse>>;
  renameAccount(id: string, body: RenameAccountInput): Promise<ApiResult<AccountResponse>>;
  /**
   * Records an adjustment so the balance becomes the target; `adjustment` is `null` when it already
   * was. Needs a connection: it is never queued offline.
   */
  setAccountBalance(
    id: string,
    body: SetAccountBalanceInput,
  ): Promise<ApiResult<SetAccountBalanceResponse>>;
  archiveAccount(id: string): Promise<ApiResult<AccountResponse>>;
  unarchiveAccount(id: string): Promise<ApiResult<AccountResponse>>;
  setIncludeInAvailable(
    id: string,
    includeInAvailable: boolean,
  ): Promise<ApiResult<AccountResponse>>;
  deleteAccount(id: string): Promise<ApiResult<undefined>>;
  listRecurringPayments(): Promise<ApiResult<ListRecurringPaymentsResponse>>;
  createRecurringPayment(
    body: CreateRecurringPayment,
  ): Promise<ApiResult<RecurringPaymentResponse>>;
  getRecurringPayment(id: string): Promise<ApiResult<RecurringPaymentResponse>>;
  updateRecurringPayment(
    id: string,
    body: UpdateRecurringPayment,
  ): Promise<ApiResult<RecurringPaymentResponse>>;
  pauseRecurringPayment(id: string): Promise<ApiResult<RecurringPaymentResponse>>;
  resumeRecurringPayment(id: string): Promise<ApiResult<RecurringPaymentResponse>>;
  /** Deletes the payment and its pending and future occurrences; recorded expenses stay. */
  deleteRecurringPayment(id: string): Promise<ApiResult<undefined>>;
  /** Overdue and pending occurrences first, then the next 30 days; needs a connection. */
  getUpcomingRecurring(): Promise<ApiResult<UpcomingResponse>>;
  /** The home dashboard read; sent with no query (spec DISC-001-09c FR-18). */
  getDashboard(): Promise<ApiResult<DashboardResponse>>;
  /** Net worth series; with no query the API answers its default 12 months ending today. */
  getNetWorthSeries(query?: NetWorthParams): Promise<ApiResult<NetWorthResponse>>;
  /** Spending by category over a range; needs a connection. */
  getExpensesByCategory(query: ReportFlowParams): Promise<ApiResult<ExpensesByCategoryResponse>>;
  /** Income against expenses by month; needs a connection. */
  getIncomeExpenses(query: ReportFlowParams): Promise<ApiResult<IncomeExpensesResponse>>;
  /** Records the expense of a pending occurrence; the answer's body is ignored, reload the list. */
  confirmOccurrence(occurrenceId: string, body: ConfirmOccurrence): Promise<ApiResult<undefined>>;
  skipOccurrence(occurrenceId: string): Promise<ApiResult<undefined>>;
  /** Newest first; `cursor` is the `nextCursor` of the previous page, passed back untouched. */
  listNotices(query?: { limit?: number; cursor?: string }): Promise<ApiResult<ListNoticesResponse>>;
  markNoticeRead(id: string): Promise<ApiResult<Notice>>;
  markAllNoticesRead(): Promise<ApiResult<MarkAllReadResponse>>;
  listCreditCards(): Promise<ApiResult<ListCreditCardsResponse>>;
  createCreditCard(body: CreateCreditCardRequest): Promise<ApiResult<CreditCardResponse>>;
  getCreditCard(id: string): Promise<ApiResult<CreditCardResponse>>;
  updateCreditCardDays(
    id: string,
    body: UpdateCreditCardRequest,
  ): Promise<ApiResult<CreditCardResponse>>;
  /** Replaces the automatic debit account of each currency; `null` clears it. Needs a connection. */
  setCardDebitAccounts(
    id: string,
    body: SetDebitAccountsRequest,
  ): Promise<ApiResult<CreditCardResponse>>;
  /** Deletes the card, its statements and its two linked accounts (409 when they have movements). */
  deleteCreditCard(id: string): Promise<ApiResult<undefined>>;
  /** Newest first; the API creates the missing cycles before answering. */
  listStatements(cardId: string): Promise<ApiResult<ListStatementsResponse>>;
  /** Records an expense on the card's ARS or USD account; needs a connection. */
  createCardExpense(
    cardId: string,
    body: CreateCardExpenseRequest,
  ): Promise<ApiResult<CardExpenseResponse>>;
  /** Uploads the lines of a parsed card statement; needs a connection. */
  createStatementImport(
    cardId: string,
    body: CreateStatementImportRequest,
  ): Promise<ApiResult<StatementImportResponse>>;
  /** Pays a statement: a transfer to the card's linked account of the currency; needs a connection. */
  recordStatementPayment(
    cardId: string,
    body: CreateStatementPaymentRequest,
  ): Promise<ApiResult<StatementPaymentResponse>>;
  /** Records an installment purchase on the card, in ARS; needs a connection. */
  createInstallmentPurchase(
    cardId: string,
    body: CreateInstallmentPurchaseRequest,
  ): Promise<ApiResult<InstallmentPurchaseResponse>>;
  /** The card's active installment purchases and its pending debt. */
  listInstallmentPurchases(cardId: string): Promise<ApiResult<ListInstallmentPurchasesResponse>>;
  /** Removes the installments of statements not closed yet; the closed ones stay. */
  deleteInstallmentPurchase(cardId: string, purchaseId: string): Promise<ApiResult<undefined>>;
  updateStatement(
    cardId: string,
    statementId: string,
    body: UpdateStatementRequest,
  ): Promise<ApiResult<StatementResponse>>;
  listCategories(query: ListCategoriesParams): Promise<ApiResult<ListCategoriesResponse>>;
  createCategory(body: CreateCategoryInput): Promise<ApiResult<CategoryResponse>>;
  getCategory(id: string): Promise<ApiResult<CategoryResponse>>;
  updateCategory(id: string, body: UpdateCategoryInput): Promise<ApiResult<CategoryResponse>>;
  archiveCategory(id: string): Promise<ApiResult<CategoryResponse>>;
  unarchiveCategory(id: string): Promise<ApiResult<CategoryResponse>>;
  deleteCategory(id: string): Promise<ApiResult<undefined>>;
  getProfile(): Promise<ApiResult<ProfileResponse>>;
  updateProfile(body: UpdateProfileRequest): Promise<ApiResult<ProfileResponse>>;
  /**
   * Deletes the signed-in user's own account (not a finance account: that is `deleteAccount`).
   * 204 on success; the cookies are cleared by the API.
   */
  deleteMyAccount(body: DeleteUserRequest): Promise<ApiResult<undefined>>;
  /** The Google URL where a password-less user confirms the deletion. */
  startDeletionReauth(): Promise<ApiResult<StartDeletionReauthResponse>>;
  listPortfolios(): Promise<ApiResult<PortfolioListResponse>>;
  createPortfolio(body: CreatePortfolioRequest): Promise<ApiResult<PortfolioResponse>>;
  deletePortfolio(portfolioId: string): Promise<ApiResult<undefined>>;
  /** 201 when created, 200 when merged into an existing holding: see `merged`. */
  addHolding(portfolioId: string, body: AddHoldingRequest): Promise<ApiResult<AddHoldingResponse>>;
  /** Replaces the holdings of a portfolio with the parsed rows of a Balanz file; the file itself is never sent. */
  importHoldings(
    portfolioId: string,
    body: ImportHoldingsRequest,
  ): Promise<ApiResult<ImportHoldingsResponse>>;
  updateHolding(holdingId: string, body: UpdateHoldingRequest): Promise<ApiResult<HoldingResponse>>;
  setHoldingPrice(holdingId: string, body: SetPriceRequest): Promise<ApiResult<HoldingResponse>>;
  setHoldingAutomaticPrice(holdingId: string): Promise<ApiResult<HoldingResponse>>;
  deleteHolding(holdingId: string): Promise<ApiResult<undefined>>;
  createMovement(body: CreateMovementInput): Promise<ApiResult<MovementResponse>>;
  getMovement(id: string): Promise<ApiResult<MovementDetailResponse>>;
  /** An invalid body is refused locally and sends no request. */
  sendMovementToGroup(
    groupId: string,
    body: SendMovementToGroupRequest,
  ): Promise<ApiResult<SendMovementToGroupResponse>>;
  /** A full replacement: what the body omits (note, tags) is cleared. */
  updateMovement(id: string, body: UpdateMovementInput): Promise<ApiResult<MovementResponse>>;
  deleteMovement(id: string): Promise<ApiResult<undefined>>;
  listMovements(query: ListMovementsParams): Promise<ApiResult<ListMovementsResponse>>;
  /** What the matching expenses and incomes add up to, by category and currency. */
  getMovementSummary(query: MovementSummaryParams): Promise<ApiResult<MovementSummaryResponse>>;
  /** The caller's stored tags that start with `prefix`, for suggestions. */
  listTags(query: ListTagsParams): Promise<ApiResult<TagSuggestionsResponse>>;
  /** Every tag of the caller, a page at a time: what the device keeps for offline suggestions. */
  listAllTags(query: ListAllTagsParams): Promise<ApiResult<ListTagsResponse>>;
  /** The stored rates only: the API never reaches the external source for this call. */
  getLatestRates(): Promise<ApiResult<LatestRatesResponse>>;
  /** An invalid body is refused locally and sends no request. */
  createGroupExpense(
    groupId: string,
    body: CreateGroupExpenseRequest,
  ): Promise<ApiResult<GroupExpenseResponse>>;
  listGroupExpenses(
    groupId: string,
    query: Pick<ListGroupExpensesQuery, 'limit' | 'cursor' | 'categoryIds' | 'from' | 'to'>,
  ): Promise<ApiResult<GroupExpensePage>>;
  /** Sums per currency and category over the range; both bounds are required. */
  getGroupExpenseSummary(
    groupId: string,
    query: GroupExpenseSummaryQuery,
  ): Promise<ApiResult<GroupExpenseSummaryResponse>>;
  /** `includeArchived` also returns archived categories, to name the category of an expense. */
  getExpenseOptions(
    groupId: string,
    query?: { includeArchived?: boolean },
  ): Promise<ApiResult<ExpenseOptionsResponse>>;
  /** An invalid body is refused locally and sends no request. */
  setDefaultSplit(
    groupId: string,
    body: DefaultSplitRequest,
  ): Promise<ApiResult<DefaultSplitResponse>>;
  listPersonalShares(
    query: Pick<PersonalSharesQuery, 'from' | 'to' | 'limit' | 'cursor'>,
  ): Promise<ApiResult<PersonalSharesPage>>;
  getGroupExpense(groupId: string, expenseId: string): Promise<ApiResult<GroupExpenseResponse>>;
  /** The payer links an expense that has no movement of theirs; an invalid body sends no request. */
  linkPayerMovement(
    groupId: string,
    expenseId: string,
    body: LinkPayerMovementRequest,
  ): Promise<ApiResult<GroupExpenseResponse>>;
  /** The payer's own movements an unlinked expense could adopt: at most 20, newest first. */
  getMovementCandidates(
    groupId: string,
    expenseId: string,
  ): Promise<ApiResult<MovementCandidatesResponse>>;
  /** A full replacement based on `body.baseVersion`; a stale one answers a conflict outcome. */
  updateGroupExpense(
    groupId: string,
    expenseId: string,
    body: UpdateGroupExpenseRequest,
  ): Promise<ApiResult<GroupExpenseResponse>>;
  deleteGroupExpense(
    groupId: string,
    expenseId: string,
    baseVersion: number,
  ): Promise<ApiResult<undefined>>;
  getSettlement(groupId: string, settlementId: string): Promise<ApiResult<SettlementResponse>>;
  /** Net balance per member and suggested payments, one block per currency. */
  getGroupBalances(groupId: string): Promise<ApiResult<BalancesResponse>>;
  listSettlements(
    groupId: string,
    query: { limit?: number; cursor?: string },
  ): Promise<ApiResult<SettlementPage>>;
  /** Newest-first activity log; a query that fails the shared schema is refused before any request. */
  listGroupActivity(
    groupId: string,
    query: { limit?: number; cursor?: string },
  ): Promise<ApiResult<ActivityPage>>;
  /** A body that fails the shared schema is refused before any request. */
  createSettlement(
    groupId: string,
    body: CreateSettlementRequest,
  ): Promise<ApiResult<SettlementResponse>>;
  /** A query that fails the shared schema (equal members) is refused before any request. */
  getConsolidationPreview(
    groupId: string,
    query: ConsolidationQuery,
  ): Promise<ApiResult<ConsolidationPreview>>;
  updateSettlement(
    groupId: string,
    settlementId: string,
    body: UpdateSettlementRequest,
  ): Promise<ApiResult<SettlementResponse>>;
  deleteSettlement(
    groupId: string,
    settlementId: string,
    baseVersion: number,
  ): Promise<ApiResult<undefined>>;
  listGroups(): Promise<ApiResult<GroupResponse[]>>;
  createGroup(body: CreateGroupRequest): Promise<ApiResult<GroupResponse>>;
  getGroup(groupId: string): Promise<ApiResult<GroupDetailResponse>>;
  updateGroupRateType(groupId: string, body: UpdateGroupRequest): Promise<ApiResult<GroupResponse>>;
  /** An empty token is refused before any request. */
  joinGroup(token: string): Promise<ApiResult<GroupResponse>>;
  claimGroupSeat(token: string): Promise<ApiResult<GroupResponse>>;
  createInvitation(groupId: string): Promise<ApiResult<InvitationResponse>>;
  addGhostMember(
    groupId: string,
    body: AddGhostMemberRequest,
  ): Promise<ApiResult<GroupMemberResponse>>;
  createClaimLink(groupId: string, memberId: string): Promise<ApiResult<ClaimLinkResponse>>;
  promoteMember(groupId: string, memberId: string): Promise<ApiResult<GroupMemberResponse>>;
  /** A `GROUP_MEMBER_HAS_BALANCE` failure carries `balances`. */
  removeMember(groupId: string, memberId: string): Promise<ApiResult<undefined>>;
  /** A `GROUP_MEMBER_HAS_BALANCE` failure carries `balances`. */
  leaveGroup(groupId: string): Promise<ApiResult<undefined>>;
  listGroupCategories(groupId: string): Promise<ApiResult<GroupCategoryResponse[]>>;
  createGroupCategory(
    groupId: string,
    body: CreateGroupCategoryRequest,
  ): Promise<ApiResult<GroupCategoryResponse>>;
  updateGroupCategory(
    groupId: string,
    categoryId: string,
    body: UpdateGroupCategoryRequest,
  ): Promise<ApiResult<GroupCategoryResponse>>;
  listGoals(): Promise<ApiResult<ListGoalsResponse>>;
  getGoal(id: string): Promise<ApiResult<GoalResponse>>;
  /** A body that fails the shared schema is refused before any request. */
  createGoal(body: CreateGoalRequest): Promise<ApiResult<GoalResponse>>;
  /** `targetDate: null` removes the date; an empty body is refused before any request. */
  updateGoal(id: string, body: UpdateGoalRequest): Promise<ApiResult<GoalResponse>>;
  deleteGoal(id: string): Promise<ApiResult<undefined>>;
  /** Answers the new entry and the updated goal. */
  recordGoalEntry(
    id: string,
    body: CreateGoalEntryRequest,
  ): Promise<ApiResult<RecordGoalEntryResponse>>;
  /** Newest first; `limit` outside 1 to 100 is refused before any request. */
  listGoalEntries(
    id: string,
    query: ListGoalEntriesQuery,
  ): Promise<ApiResult<ListGoalEntriesResponse>>;
  /** No month means the current month in the user's time zone; a malformed month is refused before any request. */
  listBudgetSpending(query: BudgetSpendingQuery): Promise<ApiResult<BudgetSpendingListResponse>>;
  getBudget(id: string): Promise<ApiResult<BudgetResponse>>;
  getBudgetSpending(
    id: string,
    query: BudgetSpendingQuery,
  ): Promise<ApiResult<BudgetSpendingResponse>>;
  /** A body that fails the shared schema is refused before any request. */
  createBudget(body: CreateBudgetRequest): Promise<ApiResult<BudgetResponse>>;
  /** Only the given fields are sent; an empty body is refused before any request. */
  updateBudget(id: string, body: UpdateBudgetRequest): Promise<ApiResult<BudgetResponse>>;
  deleteBudget(id: string): Promise<ApiResult<undefined>>;
  getPushConfig(): Promise<ApiResult<PushConfigResponse>>;
  /** Only the endpoint and the two keys are sent; a body that fails the shared schema is refused before any request. */
  storePushSubscription(
    body: PushSubscriptionRequest,
  ): Promise<ApiResult<PushSubscriptionResponse>>;
  /** Only the endpoint is sent. A 404 means the server no longer knows it. */
  removePushSubscription(body: UnsubscribeRequest): Promise<ApiResult<undefined>>;
}

/**
 * Browser client of the Express API. Session cookies are HttpOnly, so they travel only through
 * `credentials: 'include'`; bodies are parsed with the shared Zod schemas and error codes become
 * message keys, never API-provided text.
 */
export function createApiClient({
  baseUrl,
  fetch = (url, init) => globalThis.fetch(url, init),
}: ApiClientOptions): ApiClient {
  async function send<T>(options: RequestOptions<T>): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { 'X-Requested-With': REQUESTED_WITH };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${options.path}`, {
        method: options.method,
        credentials: 'include',
        cache: 'no-store',
        // A redirect would carry credentials somewhere the client never chose to talk to.
        redirect: 'error',
        headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch {
      return failure('NETWORK');
    }

    // Real `fetch` rejects on redirects with `redirect: 'error'`; this covers opaque or injected
    // 3xx answers so they are never read as API errors.
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      return failure('NETWORK');
    }

    const payload: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      // `details` of a conflict is an object, which the generic error schema (string values) rejects.
      if (response.status === 409) {
        const conflict = readGroupConflict(payload);
        if (conflict !== undefined) return conflict;
        // A conflict without its record cannot be resolved, so it is an unexpected answer.
        if (isConflictCode(payload)) return failure('INTERNAL');
      }
      const parsed = errorResponseSchema.safeParse(payload);
      if (!parsed.success) return failure('INTERNAL');
      const retryAfterSeconds = readRetryAfterSeconds(response);
      const balances =
        parsed.data.code === 'GROUP_MEMBER_HAS_BALANCE'
          ? readBalances(parsed.data.details)
          : undefined;
      const failed: ApiFailure = {
        ...failure(parsed.data.code),
        ...(parsed.data.fields ? { fields: parsed.data.fields } : {}),
        ...(balances ? { balances } : {}),
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      };
      return failed;
    }
    if (options.response === null) return { ok: true, data: undefined as T };
    const parsed = options.response.safeParse(payload);
    return parsed.success ? { ok: true, data: parsed.data } : failure('INTERNAL');
  }

  // The API rotates the refresh token on every use and treats a second use of a rotated token as
  // theft (the whole session family is revoked). Refreshes are therefore serialized across tabs
  // with the Web Locks API, and inside the lock the refused request is retried first: if another
  // tab refreshed meanwhile, the new cookies already work and this tab must not refresh again.
  // Without Web Locks, a promise chain serializes them inside this tab only.
  let inTabQueue: Promise<unknown> = Promise.resolve();

  function withRefreshLock<T>(critical: () => Promise<T>): Promise<T> {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (locks) return locks.request(REFRESH_LOCK, critical);
    const run = inTabQueue.then(critical);
    inTabQueue = run.catch(() => undefined);
    return run;
  }

  async function recoverSession<T>(options: RequestOptions<T>): Promise<ApiResult<T>> {
    const retried = await send(options);
    if (retried.ok || retried.code !== 'UNAUTHENTICATED') return retried;
    const refreshed = await send({
      method: 'POST',
      path: '/auth/refresh',
      body: {},
      response: refreshResponseSchema,
    });
    if (refreshed.ok) return send(options);
    // An unreachable API says nothing about the session: offline users must not be signed out.
    return refreshed.code === 'NETWORK' ? failure('NETWORK') : retried;
  }

  async function request<T>(options: RequestOptions<T>): Promise<ApiResult<T>> {
    const result = await send(options);
    if (result.ok || result.code !== 'UNAUTHENTICATED' || !options.refreshOnUnauthenticated) {
      return result;
    }
    return withRefreshLock(() => recoverSession(options));
  }

  function onAccount<T>(
    id: string,
    build: (path: string) => Promise<ApiResult<T>>,
  ): Promise<ApiResult<T>> {
    const path = resourcePath('accounts', id);
    return path === null ? Promise.resolve(failure('VALIDATION_FAILED')) : build(path);
  }

  function onCreditCard<T>(
    id: string,
    build: (path: string) => Promise<ApiResult<T>>,
  ): Promise<ApiResult<T>> {
    const path = resourcePath('credit-cards', id);
    return path === null ? Promise.resolve(failure('VALIDATION_FAILED')) : build(path);
  }

  function onRecurringPayment<T>(
    id: string,
    build: (path: string) => Promise<ApiResult<T>>,
  ): Promise<ApiResult<T>> {
    const path = resourcePath('recurring/payments', id);
    return path === null ? Promise.resolve(failure('VALIDATION_FAILED')) : build(path);
  }

  function onOccurrence<T>(
    id: string,
    build: (path: string) => Promise<ApiResult<T>>,
  ): Promise<ApiResult<T>> {
    const path = resourcePath('recurring/occurrences', id);
    return path === null ? Promise.resolve(failure('VALIDATION_FAILED')) : build(path);
  }

  function onStatement<T>(
    cardId: string,
    statementId: string,
    build: (path: string) => Promise<ApiResult<T>>,
  ): Promise<ApiResult<T>> {
    const card = resourcePath('credit-cards', cardId);
    const statement = resourcePath('statements', statementId);
    return card === null || statement === null
      ? Promise.resolve(failure('VALIDATION_FAILED'))
      : build(`${card}${statement}`);
  }

  function onInstallmentPurchase<T>(
    cardId: string,
    purchaseId: string,
    build: (path: string) => Promise<ApiResult<T>>,
  ): Promise<ApiResult<T>> {
    const card = resourcePath('credit-cards', cardId);
    const purchase = resourcePath('installment-purchases', purchaseId);
    return card === null || purchase === null
      ? Promise.resolve(failure('VALIDATION_FAILED'))
      : build(`${card}${purchase}`);
  }

  function onCategory<T>(
    id: string,
    build: (path: string) => Promise<ApiResult<T>>,
  ): Promise<ApiResult<T>> {
    const path = resourcePath('categories', id);
    return path === null ? Promise.resolve(failure('VALIDATION_FAILED')) : build(path);
  }

  function onMovement<T>(
    id: string,
    build: (path: string) => Promise<ApiResult<T>>,
  ): Promise<ApiResult<T>> {
    const path = resourcePath('movements', id);
    return path === null ? Promise.resolve(failure('VALIDATION_FAILED')) : build(path);
  }

  function onGroupRecord<T>(
    groupId: string,
    collection: string,
    recordId: string,
    build: (path: string) => Promise<ApiResult<T>>,
  ): Promise<ApiResult<T>> {
    const group = resourcePath('groups', groupId);
    const record = resourcePath(collection, recordId);
    return group === null || record === null
      ? Promise.resolve(failure('VALIDATION_FAILED'))
      : build(`${group}${record}`);
  }

  function onGoal<T>(
    id: string,
    build: (path: string) => Promise<ApiResult<T>>,
  ): Promise<ApiResult<T>> {
    const path = resourcePath('goals', id);
    return path === null ? Promise.resolve(failure('VALIDATION_FAILED')) : build(path);
  }

  function onBudget<T>(
    id: string,
    build: (path: string) => Promise<ApiResult<T>>,
  ): Promise<ApiResult<T>> {
    const path = resourcePath('budgets', id);
    return path === null ? Promise.resolve(failure('VALIDATION_FAILED')) : build(path);
  }

  /** The month is already validated as `YYYY-MM`; no month means the current one. */
  function monthSuffix(month: string | undefined): string {
    return month === undefined ? '' : `?month=${month}`;
  }

  function onGroup<T>(
    groupId: string,
    build: (path: string) => Promise<ApiResult<T>>,
  ): Promise<ApiResult<T>> {
    const path = resourcePath('groups', groupId);
    return path === null ? Promise.resolve(failure('VALIDATION_FAILED')) : build(path);
  }

  /** The server judges a token's content; the client only refuses what cannot be one. */
  function withToken<T>(
    token: string,
    build: (token: string) => Promise<ApiResult<T>>,
  ): Promise<ApiResult<T>> {
    return token.trim() === '' || token.length > GROUP_TOKEN_CLIENT_MAX
      ? Promise.resolve(failure('VALIDATION_FAILED'))
      : build(token);
  }

  return {
    register: (body) =>
      request({ method: 'POST', path: '/auth/register', body, response: registerResponseSchema }),
    verifyEmail: (body) =>
      request({
        method: 'POST',
        path: '/auth/verify-email',
        body,
        response: verifyEmailResponseSchema,
      }),
    resendVerification: () =>
      request({
        method: 'POST',
        path: '/auth/verification/resend',
        body: {},
        response: resendVerificationResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    signIn: (body) =>
      request({ method: 'POST', path: '/auth/sign-in', body, response: signInResponseSchema }),
    signOut: () => request({ method: 'POST', path: '/auth/sign-out', body: {}, response: null }),
    getSession: () =>
      request({
        method: 'GET',
        path: '/auth/session',
        response: sessionResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    requestPasswordReset: (body) =>
      request({
        method: 'POST',
        path: '/auth/password-reset/request',
        body,
        response: passwordResetResponseSchema,
      }),
    confirmPasswordReset: (body) =>
      request({
        method: 'POST',
        path: '/auth/password-reset/confirm',
        body,
        response: passwordResetConfirmResponseSchema,
      }),
    getTwoFactorStatus: () =>
      request({
        method: 'GET',
        path: '/auth/2fa',
        response: twoFactorStatusResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    startTwoFactorSetup: () =>
      request({
        method: 'POST',
        path: '/auth/2fa/setup',
        body: {},
        response: twoFactorSetupResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    enableTwoFactor: (body) =>
      request({
        method: 'POST',
        path: '/auth/2fa/enable',
        body,
        response: twoFactorEnableResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    disableTwoFactor: (body) =>
      request({
        method: 'POST',
        path: '/auth/2fa/disable',
        body,
        response: null,
        refreshOnUnauthenticated: true,
      }),
    // No refresh: before the second step there is no session to recover.
    verifySecondFactor: (body) =>
      request({
        method: 'POST',
        path: '/auth/2fa/verify',
        body,
        response: secondFactorVerifyResponseSchema,
      }),
    listAccounts: ({ archived, limit, offset }) => {
      const query = new URLSearchParams();
      if (archived !== undefined) query.set('archived', archived ? 'true' : 'false');
      if (limit !== undefined) query.set('limit', String(limit));
      if (offset !== undefined) query.set('offset', String(offset));
      const queryString = query.toString();
      return request({
        method: 'GET',
        path: queryString ? `/accounts?${queryString}` : '/accounts',
        response: listAccountsResponseSchema,
        refreshOnUnauthenticated: true,
      });
    },
    createAccount: (body) =>
      request({
        method: 'POST',
        path: '/accounts',
        body,
        response: accountResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    getAccount: (id) =>
      onAccount(id, (path) =>
        request({
          method: 'GET',
          path,
          response: accountResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    renameAccount: (id, body) =>
      onAccount(id, (path) =>
        request({
          method: 'PATCH',
          path,
          body,
          response: accountResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    setAccountBalance: (id, { balance, note, secondFactorCode }) =>
      onAccount(id, (path) =>
        request({
          method: 'POST',
          path: `${path}/balance`,
          body: {
            balance,
            ...(note === undefined ? {} : { note }),
            ...(secondFactorCode === undefined ? {} : { secondFactorCode }),
          },
          response: setAccountBalanceResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    archiveAccount: (id) =>
      onAccount(id, (path) =>
        request({
          method: 'POST',
          path: `${path}/archive`,
          body: {},
          response: accountResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    unarchiveAccount: (id) =>
      onAccount(id, (path) =>
        request({
          method: 'POST',
          path: `${path}/unarchive`,
          body: {},
          response: accountResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    setIncludeInAvailable: (id, includeInAvailable) =>
      onAccount(id, (path) =>
        request({
          method: 'PUT',
          path: `${path}/include-in-available`,
          body: { includeInAvailable },
          response: accountResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    deleteAccount: (id) =>
      onAccount(id, (path) =>
        request({
          method: 'DELETE',
          path,
          response: null,
          refreshOnUnauthenticated: true,
        }),
      ),
    listRecurringPayments: () =>
      request({
        method: 'GET',
        path: '/recurring/payments',
        response: listRecurringPaymentsResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    createRecurringPayment: (body) =>
      request({
        method: 'POST',
        path: '/recurring/payments',
        body,
        response: recurringPaymentResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    getRecurringPayment: (id) =>
      onRecurringPayment(id, (path) =>
        request({
          method: 'GET',
          path,
          response: recurringPaymentResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    updateRecurringPayment: (id, body) =>
      onRecurringPayment(id, (path) =>
        request({
          method: 'PATCH',
          path,
          body,
          response: recurringPaymentResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    pauseRecurringPayment: (id) =>
      onRecurringPayment(id, (path) =>
        request({
          method: 'POST',
          path: `${path}/pause`,
          body: {},
          response: recurringPaymentResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    resumeRecurringPayment: (id) =>
      onRecurringPayment(id, (path) =>
        request({
          method: 'POST',
          path: `${path}/resume`,
          body: {},
          response: recurringPaymentResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    deleteRecurringPayment: (id) =>
      onRecurringPayment(id, (path) =>
        request({ method: 'DELETE', path, response: null, refreshOnUnauthenticated: true }),
      ),
    getUpcomingRecurring: () =>
      request({
        method: 'GET',
        path: '/recurring/upcoming',
        response: upcomingResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    getDashboard: () =>
      request({
        method: 'GET',
        path: '/dashboard',
        response: dashboardResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    getNetWorthSeries: (query) =>
      request({
        method: 'GET',
        path: `/reports/net-worth${reportQueryString(query, ['from', 'to'])}`,
        response: netWorthResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    getExpensesByCategory: (query) =>
      request({
        method: 'GET',
        path: `/reports/expenses-by-category${reportQueryString(query, ['from', 'to', 'accountId', 'tag'])}`,
        response: expensesByCategoryResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    getIncomeExpenses: (query) =>
      request({
        method: 'GET',
        path: `/reports/income-expenses${reportQueryString(query, ['from', 'to', 'accountId', 'tag'])}`,
        response: incomeExpensesResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    confirmOccurrence: (occurrenceId, body) =>
      onOccurrence(occurrenceId, (path) =>
        request({
          method: 'POST',
          path: `${path}/confirm`,
          body,
          response: null,
          refreshOnUnauthenticated: true,
        }),
      ),
    skipOccurrence: (occurrenceId) =>
      onOccurrence(occurrenceId, (path) =>
        request({
          method: 'POST',
          path: `${path}/skip`,
          body: {},
          response: null,
          refreshOnUnauthenticated: true,
        }),
      ),
    listNotices: (query) => {
      const params = new URLSearchParams();
      if (query?.limit !== undefined) params.set('limit', String(query.limit));
      if (query?.cursor !== undefined) params.set('cursor', query.cursor);
      const queryString = params.toString();
      return request({
        method: 'GET',
        path: queryString ? `/notices?${queryString}` : '/notices',
        response: listNoticesResponseSchema,
        refreshOnUnauthenticated: true,
      });
    },
    markNoticeRead: (id) => {
      const path = resourcePath('notices', id);
      return path === null
        ? Promise.resolve(failure('VALIDATION_FAILED'))
        : request({
            method: 'POST',
            path: `${path}/read`,
            body: {},
            response: noticeSchema,
            refreshOnUnauthenticated: true,
          });
    },
    markAllNoticesRead: () =>
      request({
        method: 'POST',
        path: '/notices/read-all',
        body: {},
        response: markAllReadResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    listCreditCards: () =>
      request({
        method: 'GET',
        path: '/credit-cards',
        response: listCreditCardsResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    createCreditCard: (body) =>
      request({
        method: 'POST',
        path: '/credit-cards',
        body,
        response: creditCardResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    getCreditCard: (id) =>
      onCreditCard(id, (path) =>
        request({
          method: 'GET',
          path,
          response: creditCardResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    updateCreditCardDays: (id, body) =>
      onCreditCard(id, (path) =>
        request({
          method: 'PATCH',
          path,
          body,
          response: creditCardResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    setCardDebitAccounts: (id, body) =>
      onCreditCard(id, (path) =>
        request({
          method: 'PUT',
          path: `${path}/debit-accounts`,
          body,
          response: creditCardResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    deleteCreditCard: (id) =>
      onCreditCard(id, (path) =>
        request({ method: 'DELETE', path, response: null, refreshOnUnauthenticated: true }),
      ),
    listStatements: (cardId) =>
      onCreditCard(cardId, (path) =>
        request({
          method: 'GET',
          path: `${path}/statements`,
          response: listStatementsResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    createCardExpense: (cardId, body) =>
      onCreditCard(cardId, (path) =>
        request({
          method: 'POST',
          path: `${path}/expenses`,
          body,
          response: cardExpenseResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    createStatementImport: (cardId, body) =>
      onCreditCard(cardId, (path) =>
        request({
          method: 'POST',
          path: `${path}/statement-imports`,
          body,
          response: statementImportResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    recordStatementPayment: (cardId, body) =>
      onCreditCard(cardId, (path) =>
        request({
          method: 'POST',
          path: `${path}/payments`,
          body,
          response: statementPaymentResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    createInstallmentPurchase: (cardId, body) =>
      onCreditCard(cardId, (path) =>
        request({
          method: 'POST',
          path: `${path}/installment-purchases`,
          body,
          response: installmentPurchaseResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    listInstallmentPurchases: (cardId) =>
      onCreditCard(cardId, (path) =>
        request({
          method: 'GET',
          path: `${path}/installment-purchases`,
          response: listInstallmentPurchasesResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    deleteInstallmentPurchase: (cardId, purchaseId) =>
      onInstallmentPurchase(cardId, purchaseId, (path) =>
        request({ method: 'DELETE', path, response: null, refreshOnUnauthenticated: true }),
      ),
    updateStatement: (cardId, statementId, body) =>
      onStatement(cardId, statementId, (path) =>
        request({
          method: 'PATCH',
          path,
          body,
          response: statementResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    listCategories: ({ kind, archived, limit, offset }) => {
      const query = new URLSearchParams();
      if (kind !== undefined) query.set('kind', kind);
      if (archived !== undefined) query.set('archived', archived ? 'true' : 'false');
      if (limit !== undefined) query.set('limit', String(limit));
      if (offset !== undefined) query.set('offset', String(offset));
      const queryString = query.toString();
      return request({
        method: 'GET',
        path: queryString ? `/categories?${queryString}` : '/categories',
        response: listCategoriesResponseSchema,
        refreshOnUnauthenticated: true,
      });
    },
    createCategory: (body) =>
      request({
        method: 'POST',
        path: '/categories',
        body,
        response: categoryResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    getCategory: (id) =>
      onCategory(id, (path) =>
        request({
          method: 'GET',
          path,
          response: categoryResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    updateCategory: (id, body) =>
      onCategory(id, (path) =>
        request({
          method: 'PATCH',
          path,
          body,
          response: categoryResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    archiveCategory: (id) =>
      onCategory(id, (path) =>
        request({
          method: 'POST',
          path: `${path}/archive`,
          body: {},
          response: categoryResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    unarchiveCategory: (id) =>
      onCategory(id, (path) =>
        request({
          method: 'POST',
          path: `${path}/unarchive`,
          body: {},
          response: categoryResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    deleteCategory: (id) =>
      onCategory(id, (path) =>
        request({
          method: 'DELETE',
          path,
          response: null,
          refreshOnUnauthenticated: true,
        }),
      ),
    getProfile: () =>
      request({
        method: 'GET',
        path: '/profile',
        response: profileResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    updateProfile: (body) =>
      request({
        method: 'PATCH',
        path: '/profile',
        body,
        response: profileResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    deleteMyAccount: (body) =>
      request({
        method: 'POST',
        path: '/profile/delete',
        body,
        response: null,
        refreshOnUnauthenticated: true,
      }),
    startDeletionReauth: () =>
      request({
        method: 'POST',
        path: '/profile/delete/google/start',
        body: {},
        response: startDeletionReauthResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    listPortfolios: () =>
      request({
        method: 'GET',
        path: '/investments/portfolios',
        response: portfolioListResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    createPortfolio: (body) =>
      request({
        method: 'POST',
        path: '/investments/portfolios',
        body,
        response: portfolioResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    deletePortfolio: (portfolioId) =>
      request({
        method: 'DELETE',
        path: `/investments/portfolios/${encodeURIComponent(portfolioId)}`,
        response: null,
        refreshOnUnauthenticated: true,
      }),
    addHolding: (portfolioId, body) =>
      request({
        method: 'POST',
        path: `/investments/portfolios/${encodeURIComponent(portfolioId)}/holdings`,
        body,
        response: addHoldingResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    importHoldings: (portfolioId, body) =>
      request({
        method: 'POST',
        path: `/investments/portfolios/${encodeURIComponent(portfolioId)}/holdings/import`,
        body,
        response: importHoldingsResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    updateHolding: (holdingId, body) =>
      request({
        method: 'PATCH',
        path: `/investments/holdings/${encodeURIComponent(holdingId)}`,
        body,
        response: holdingResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    setHoldingPrice: (holdingId, body) =>
      request({
        method: 'PUT',
        path: `/investments/holdings/${encodeURIComponent(holdingId)}/price`,
        body,
        response: holdingResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    setHoldingAutomaticPrice: (holdingId) =>
      request({
        method: 'POST',
        path: `/investments/holdings/${encodeURIComponent(holdingId)}/automatic-price`,
        response: holdingResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    deleteHolding: (holdingId) =>
      request({
        method: 'DELETE',
        path: `/investments/holdings/${encodeURIComponent(holdingId)}`,
        response: null,
        refreshOnUnauthenticated: true,
      }),
    createMovement: (body) =>
      request({
        method: 'POST',
        path: '/movements',
        body,
        response: movementResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    getMovement: (id) =>
      onMovement(id, (path) =>
        request({
          method: 'GET',
          path,
          response: movementDetailResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    sendMovementToGroup: (groupId, body) =>
      onGroup(groupId, (path) =>
        sendMovementToGroupRequestSchema.safeParse(body).success
          ? request({
              method: 'POST',
              path: `${path}/expenses/from-movement`,
              body,
              response: sendMovementToGroupResponseSchema,
              refreshOnUnauthenticated: true,
            })
          : Promise.resolve(failure('VALIDATION_FAILED')),
      ),
    updateMovement: (id, body) =>
      onMovement(id, (path) =>
        request({
          method: 'PUT',
          path,
          body,
          response: movementResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    deleteMovement: (id) =>
      onMovement(id, (path) =>
        request({
          method: 'DELETE',
          path,
          response: null,
          refreshOnUnauthenticated: true,
        }),
      ),
    listMovements: (params) => {
      const query = new URLSearchParams();
      for (const key of LIST_MOVEMENTS_QUERY_KEYS) {
        const value = params[key];
        if (value !== undefined) query.set(key, String(value));
      }
      const queryString = query.toString();
      return request({
        method: 'GET',
        path: queryString ? `/movements?${queryString}` : '/movements',
        response: listMovementsResponseSchema,
        refreshOnUnauthenticated: true,
      });
    },
    getMovementSummary: (params) => {
      const query = new URLSearchParams();
      for (const key of MOVEMENT_SUMMARY_QUERY_KEYS) {
        const value = params[key];
        if (value !== undefined) query.set(key, value);
      }
      const queryString = query.toString();
      return request({
        method: 'GET',
        path: queryString ? `/movements/summary?${queryString}` : '/movements/summary',
        response: movementSummaryResponseSchema,
        refreshOnUnauthenticated: true,
      });
    },
    listTags: ({ prefix, limit }) => {
      const query = new URLSearchParams({ prefix });
      if (limit !== undefined) query.set('limit', String(limit));
      return request({
        method: 'GET',
        path: `/tags?${query.toString()}`,
        response: tagSuggestionsResponseSchema,
        refreshOnUnauthenticated: true,
      });
    },
    listAllTags: ({ limit, offset }) => {
      const query = new URLSearchParams();
      if (limit !== undefined) query.set('limit', String(limit));
      if (offset !== undefined && offset > 0) query.set('offset', String(offset));
      const queryString = query.toString();
      return request({
        method: 'GET',
        path: queryString ? `/tags/all?${queryString}` : '/tags/all',
        response: listTagsResponseSchema,
        refreshOnUnauthenticated: true,
      });
    },
    getLatestRates: () =>
      request({
        method: 'GET',
        path: '/exchange-rates/latest',
        response: latestRatesResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    createGroupExpense: (groupId, body) =>
      onGroup(groupId, (path) =>
        createGroupExpenseRequestSchema.safeParse(body).success
          ? request({
              method: 'POST',
              path: `${path}/expenses`,
              body,
              response: groupExpenseResponseSchema,
              refreshOnUnauthenticated: true,
            })
          : Promise.resolve(failure('VALIDATION_FAILED')),
      ),
    listGroupExpenses: (groupId, { limit, cursor, categoryIds, from, to }) =>
      onGroup(groupId, (path) => {
        const query = new URLSearchParams();
        if (limit !== undefined) query.set('limit', String(limit));
        if (cursor !== undefined) query.set('cursor', cursor);
        if (categoryIds !== undefined) query.set('categoryIds', categoryIds.join(','));
        if (from !== undefined) query.set('from', from);
        if (to !== undefined) query.set('to', to);
        if (!listGroupExpensesQuerySchema.safeParse(Object.fromEntries(query)).success) {
          return Promise.resolve(failure('VALIDATION_FAILED'));
        }
        const queryString = query.toString();
        return request({
          method: 'GET',
          path: queryString ? `${path}/expenses?${queryString}` : `${path}/expenses`,
          response: groupExpensePageSchema,
          refreshOnUnauthenticated: true,
        });
      }),
    getGroupExpenseSummary: (groupId, { from, to }) =>
      onGroup(groupId, (path) => {
        const query = new URLSearchParams();
        query.set('from', from);
        query.set('to', to);
        if (!groupExpenseSummaryQuerySchema.safeParse(Object.fromEntries(query)).success) {
          return Promise.resolve(failure('VALIDATION_FAILED'));
        }
        return request({
          method: 'GET',
          path: `${path}/expenses/summary?${query.toString()}`,
          response: groupExpenseSummaryResponseSchema,
          refreshOnUnauthenticated: true,
        });
      }),
    getExpenseOptions: (groupId, query) =>
      onGroup(groupId, (path) =>
        request({
          method: 'GET',
          path:
            query?.includeArchived === true
              ? `${path}/expense-options?includeArchived=true`
              : `${path}/expense-options`,
          response: expenseOptionsResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    setDefaultSplit: (groupId, body) =>
      onGroup(groupId, (path) =>
        defaultSplitRequestSchema.safeParse(body).success
          ? request({
              method: 'PUT',
              path: `${path}/default-split`,
              body,
              response: defaultSplitResponseSchema,
              refreshOnUnauthenticated: true,
            })
          : Promise.resolve(failure('VALIDATION_FAILED')),
      ),
    listPersonalShares: ({ from, to, limit, cursor }) => {
      const query = new URLSearchParams();
      if (from !== undefined) query.set('from', from);
      if (to !== undefined) query.set('to', to);
      if (limit !== undefined) query.set('limit', String(limit));
      if (cursor !== undefined) query.set('cursor', cursor);
      const queryString = query.toString();
      return request({
        method: 'GET',
        path: queryString ? `/groups/personal/shares?${queryString}` : '/groups/personal/shares',
        response: personalSharesPageSchema,
        refreshOnUnauthenticated: true,
      });
    },
    getGroupExpense: (groupId, expenseId) =>
      onGroupRecord(groupId, 'expenses', expenseId, (path) =>
        request({
          method: 'GET',
          path,
          response: groupExpenseResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    linkPayerMovement: (groupId, expenseId, body) =>
      onGroupRecord(groupId, 'expenses', expenseId, (path) =>
        linkPayerMovementRequestSchema.safeParse(body).success
          ? request({
              method: 'POST',
              path: `${path}/payer-movement`,
              body,
              response: groupExpenseResponseSchema,
              refreshOnUnauthenticated: true,
            })
          : Promise.resolve(failure('VALIDATION_FAILED')),
      ),
    getMovementCandidates: (groupId, expenseId) =>
      onGroupRecord(groupId, 'expenses', expenseId, (path) =>
        request({
          method: 'GET',
          path: `${path}/movement-candidates`,
          response: movementCandidatesResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    updateGroupExpense: (groupId, expenseId, body) =>
      onGroupRecord(groupId, 'expenses', expenseId, (path) =>
        request({
          method: 'PUT',
          path,
          body,
          response: groupExpenseResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    deleteGroupExpense: (groupId, expenseId, baseVersion) =>
      onGroupRecord(groupId, 'expenses', expenseId, (path) =>
        request({
          method: 'DELETE',
          path: `${path}?baseVersion=${String(baseVersion)}`,
          response: null,
          refreshOnUnauthenticated: true,
        }),
      ),
    getSettlement: (groupId, settlementId) =>
      onGroupRecord(groupId, 'settlements', settlementId, (path) =>
        request({
          method: 'GET',
          path,
          response: settlementResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    getGroupBalances: (groupId) =>
      onGroup(groupId, (path) =>
        request({
          method: 'GET',
          path: `${path}/balances`,
          response: balancesResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    listSettlements: (groupId, { limit, cursor }) =>
      onGroup(groupId, (path) => {
        const query = new URLSearchParams();
        if (limit !== undefined) query.set('limit', String(limit));
        if (cursor !== undefined) query.set('cursor', cursor);
        const queryString = query.toString();
        return request({
          method: 'GET',
          path: queryString ? `${path}/settlements?${queryString}` : `${path}/settlements`,
          response: settlementPageSchema,
          refreshOnUnauthenticated: true,
        });
      }),
    listGroupActivity: (groupId, query) =>
      onGroup(groupId, (path) => {
        if (!listActivityQuerySchema.safeParse(query).success) {
          return Promise.resolve(failure('VALIDATION_FAILED'));
        }
        const params = new URLSearchParams();
        if (query.limit !== undefined) params.set('limit', String(query.limit));
        if (query.cursor !== undefined) params.set('cursor', query.cursor);
        const queryString = params.toString();
        return request({
          method: 'GET',
          path: queryString ? `${path}/activity?${queryString}` : `${path}/activity`,
          response: activityPageSchema,
          refreshOnUnauthenticated: true,
        });
      }),
    createSettlement: (groupId, body) =>
      onGroup(groupId, (path) =>
        createSettlementRequestSchema.safeParse(body).success
          ? request({
              method: 'POST',
              path: `${path}/settlements`,
              body,
              response: settlementResponseSchema,
              refreshOnUnauthenticated: true,
            })
          : Promise.resolve(failure('VALIDATION_FAILED')),
      ),
    getConsolidationPreview: (groupId, query) =>
      onGroup(groupId, (path) => {
        const parsed = consolidationQuerySchema.safeParse(query);
        if (!parsed.success) return Promise.resolve(failure('VALIDATION_FAILED'));
        const params = new URLSearchParams({
          memberA: parsed.data.memberA,
          memberB: parsed.data.memberB,
          currency: parsed.data.currency,
        });
        return request({
          method: 'GET',
          path: `${path}/settlements/consolidation?${params.toString()}`,
          response: consolidationPreviewSchema,
          refreshOnUnauthenticated: true,
        });
      }),
    updateSettlement: (groupId, settlementId, body) =>
      onGroupRecord(groupId, 'settlements', settlementId, (path) =>
        request({
          method: 'PATCH',
          path,
          body,
          response: settlementResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    deleteSettlement: (groupId, settlementId, baseVersion) =>
      onGroupRecord(groupId, 'settlements', settlementId, (path) =>
        request({
          method: 'DELETE',
          path: `${path}?baseVersion=${String(baseVersion)}`,
          response: null,
          refreshOnUnauthenticated: true,
        }),
      ),
    listGroups: () =>
      request({
        method: 'GET',
        path: '/groups',
        response: groupListResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    createGroup: (body) =>
      request({
        method: 'POST',
        path: '/groups',
        body,
        response: groupResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    getGroup: (groupId) =>
      onGroup(groupId, (path) =>
        request({
          method: 'GET',
          path,
          response: groupDetailResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    updateGroupRateType: (groupId, body) =>
      onGroup(groupId, (path) =>
        request({
          method: 'PATCH',
          path,
          body,
          response: groupResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    joinGroup: (token) =>
      withToken(token, (valid) =>
        request({
          method: 'POST',
          path: '/groups/join',
          body: { token: valid },
          response: groupResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    claimGroupSeat: (token) =>
      withToken(token, (valid) =>
        request({
          method: 'POST',
          path: '/groups/claim',
          body: { token: valid },
          response: groupResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    createInvitation: (groupId) =>
      onGroup(groupId, (path) =>
        request({
          method: 'POST',
          path: `${path}/invitations`,
          body: {},
          response: invitationResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    addGhostMember: (groupId, body) =>
      onGroup(groupId, (path) =>
        request({
          method: 'POST',
          path: `${path}/ghost-members`,
          body,
          response: groupMemberResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    createClaimLink: (groupId, memberId) =>
      onGroupRecord(groupId, 'members', memberId, (path) =>
        request({
          method: 'POST',
          path: `${path}/claim-links`,
          body: {},
          response: claimLinkResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    promoteMember: (groupId, memberId) =>
      onGroupRecord(groupId, 'members', memberId, (path) =>
        request({
          method: 'POST',
          path: `${path}/admin`,
          body: {},
          response: groupMemberResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    removeMember: (groupId, memberId) =>
      onGroupRecord(groupId, 'members', memberId, (path) =>
        request({
          method: 'DELETE',
          path,
          response: null,
          refreshOnUnauthenticated: true,
        }),
      ),
    leaveGroup: (groupId) =>
      onGroup(groupId, (path) =>
        request({
          method: 'POST',
          path: `${path}/leave`,
          body: {},
          response: null,
          refreshOnUnauthenticated: true,
        }),
      ),
    listGroupCategories: (groupId) =>
      onGroup(groupId, (path) =>
        request({
          method: 'GET',
          path: `${path}/categories`,
          response: groupCategoryListResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    createGroupCategory: (groupId, body) =>
      onGroup(groupId, (path) =>
        request({
          method: 'POST',
          path: `${path}/categories`,
          body,
          response: groupCategoryResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    updateGroupCategory: (groupId, categoryId, body) =>
      onGroupRecord(groupId, 'categories', categoryId, (path) =>
        request({
          method: 'PATCH',
          path,
          body,
          response: groupCategoryResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    listGoals: () =>
      request({
        method: 'GET',
        path: '/goals',
        response: listGoalsResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    getGoal: (id) =>
      onGoal(id, (path) =>
        request({
          method: 'GET',
          path,
          response: goalResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    createGoal: (body) => {
      const parsed = createGoalRequestSchema.safeParse(body);
      if (!parsed.success) return Promise.resolve(failure('VALIDATION_FAILED'));
      return request({
        method: 'POST',
        path: '/goals',
        body: parsed.data,
        response: goalResponseSchema,
        refreshOnUnauthenticated: true,
      });
    },
    updateGoal: (id, body) =>
      onGoal(id, (path) => {
        const parsed = updateGoalRequestSchema.safeParse(body);
        if (!parsed.success) return Promise.resolve(failure('VALIDATION_FAILED'));
        return request({
          method: 'PATCH',
          path,
          body: parsed.data,
          response: goalResponseSchema,
          refreshOnUnauthenticated: true,
        });
      }),
    deleteGoal: (id) =>
      onGoal(id, (path) =>
        request({ method: 'DELETE', path, response: null, refreshOnUnauthenticated: true }),
      ),
    recordGoalEntry: (id, body) =>
      onGoal(id, (path) => {
        const parsed = createGoalEntryRequestSchema.safeParse(body);
        if (!parsed.success) return Promise.resolve(failure('VALIDATION_FAILED'));
        return request({
          method: 'POST',
          path: `${path}/entries`,
          body: parsed.data,
          response: recordGoalEntryResponseSchema,
          refreshOnUnauthenticated: true,
        });
      }),
    listGoalEntries: (id, query) =>
      onGoal(id, (path) => {
        const parsed = listGoalEntriesQuerySchema.safeParse(query);
        if (!parsed.success) return Promise.resolve(failure('VALIDATION_FAILED'));
        const params = new URLSearchParams();
        if (parsed.data.limit !== undefined) params.set('limit', String(parsed.data.limit));
        const suffix = params.size > 0 ? `?${params.toString()}` : '';
        return request({
          method: 'GET',
          path: `${path}/entries${suffix}`,
          response: listGoalEntriesResponseSchema,
          refreshOnUnauthenticated: true,
        });
      }),
    listBudgetSpending: (query) => {
      const parsed = budgetSpendingQuerySchema.safeParse(query);
      if (!parsed.success) return Promise.resolve(failure('VALIDATION_FAILED'));
      return request({
        method: 'GET',
        path: `/budgets/spending${monthSuffix(parsed.data.month)}`,
        response: budgetSpendingListResponseSchema,
        refreshOnUnauthenticated: true,
      });
    },
    getBudget: (id) =>
      onBudget(id, (path) =>
        request({
          method: 'GET',
          path,
          response: budgetResponseSchema,
          refreshOnUnauthenticated: true,
        }),
      ),
    getBudgetSpending: (id, query) =>
      onBudget(id, (path) => {
        const parsed = budgetSpendingQuerySchema.safeParse(query);
        if (!parsed.success) return Promise.resolve(failure('VALIDATION_FAILED'));
        return request({
          method: 'GET',
          path: `${path}/spending${monthSuffix(parsed.data.month)}`,
          response: budgetSpendingResponseSchema,
          refreshOnUnauthenticated: true,
        });
      }),
    createBudget: (body) => {
      const parsed = createBudgetRequestSchema.safeParse(body);
      if (!parsed.success) return Promise.resolve(failure('VALIDATION_FAILED'));
      return request({
        method: 'POST',
        path: '/budgets',
        body: parsed.data,
        response: budgetResponseSchema,
        refreshOnUnauthenticated: true,
      });
    },
    updateBudget: (id, body) =>
      onBudget(id, (path) => {
        const parsed = updateBudgetRequestSchema.safeParse(body);
        if (!parsed.success) return Promise.resolve(failure('VALIDATION_FAILED'));
        return request({
          method: 'PATCH',
          path,
          body: parsed.data,
          response: budgetResponseSchema,
          refreshOnUnauthenticated: true,
        });
      }),
    deleteBudget: (id) =>
      onBudget(id, (path) =>
        request({ method: 'DELETE', path, response: null, refreshOnUnauthenticated: true }),
      ),
    getPushConfig: () =>
      request({
        method: 'GET',
        path: '/push/config',
        response: pushConfigResponseSchema,
        refreshOnUnauthenticated: true,
      }),
    storePushSubscription: (body) => {
      // Parsing also strips what the browser adds (`expirationTime`), so only the three fields leave.
      const parsed = pushSubscriptionRequestSchema.safeParse(body);
      if (!parsed.success) return Promise.resolve(failure('VALIDATION_FAILED'));
      return request({
        method: 'PUT',
        path: '/push/subscriptions',
        body: parsed.data,
        response: pushSubscriptionResponseSchema,
        refreshOnUnauthenticated: true,
      });
    },
    removePushSubscription: (body) => {
      const parsed = unsubscribeRequestSchema.safeParse(body);
      if (!parsed.success) return Promise.resolve(failure('VALIDATION_FAILED'));
      return request({
        method: 'POST',
        path: '/push/subscriptions/unsubscribe',
        body: parsed.data,
        response: null,
        refreshOnUnauthenticated: true,
      });
    },
  };
}
