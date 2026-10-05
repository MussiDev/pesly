import {
  accountResponseSchema,
  categoryResponseSchema,
  errorResponseSchema,
  listAccountsResponseSchema,
  listCategoriesResponseSchema,
  addHoldingResponseSchema,
  holdingResponseSchema,
  latestRatesResponseSchema,
  listMovementsResponseSchema,
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
  type CreatePortfolioRequest,
  type HoldingResponse,
  type PortfolioListResponse,
  type PortfolioResponse,
  type SetPriceRequest,
  type UpdateHoldingRequest,
  type PasswordResetConfirmRequest,
  type PasswordResetConfirmResponse,
  type PasswordResetRequest,
  type PasswordResetResponse,
  type ProfileResponse,
  type RegisterRequest,
  type RegisterResponse,
  type RenameAccountRequest,
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
import type { z } from 'zod';

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
};

/** `null` when the id is not a plain path segment: '.' and '..' survive encoding and would be normalized. */
function resourcePath(collection: string, id: string): string | null {
  if (id === '' || id === '.' || id === '..') return null;
  return `/${collection}/${encodeURIComponent(id)}`;
}

function failure(code: ApiFailureCode): ApiFailure {
  return { ok: false, code, messageKey: MESSAGE_KEY_BY_CODE[code] };
}

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
    'limit' | 'offset' | 'accountId' | 'categoryId' | 'from' | 'to' | 'type' | 'tag'
  >
>;

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
] as const satisfies readonly (keyof ListMovementsParams)[];

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
  archiveAccount(id: string): Promise<ApiResult<AccountResponse>>;
  unarchiveAccount(id: string): Promise<ApiResult<AccountResponse>>;
  setIncludeInAvailable(
    id: string,
    includeInAvailable: boolean,
  ): Promise<ApiResult<AccountResponse>>;
  deleteAccount(id: string): Promise<ApiResult<undefined>>;
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
  updateHolding(holdingId: string, body: UpdateHoldingRequest): Promise<ApiResult<HoldingResponse>>;
  setHoldingPrice(holdingId: string, body: SetPriceRequest): Promise<ApiResult<HoldingResponse>>;
  setHoldingAutomaticPrice(holdingId: string): Promise<ApiResult<HoldingResponse>>;
  deleteHolding(holdingId: string): Promise<ApiResult<undefined>>;
  createMovement(body: CreateMovementInput): Promise<ApiResult<MovementResponse>>;
  getMovement(id: string): Promise<ApiResult<MovementResponse>>;
  /** A full replacement: what the body omits (note, tags) is cleared. */
  updateMovement(id: string, body: UpdateMovementInput): Promise<ApiResult<MovementResponse>>;
  deleteMovement(id: string): Promise<ApiResult<undefined>>;
  listMovements(query: ListMovementsParams): Promise<ApiResult<ListMovementsResponse>>;
  /** The caller's stored tags that start with `prefix`, for suggestions. */
  listTags(query: ListTagsParams): Promise<ApiResult<TagSuggestionsResponse>>;
  /** Every tag of the caller, a page at a time: what the device keeps for offline suggestions. */
  listAllTags(query: ListAllTagsParams): Promise<ApiResult<ListTagsResponse>>;
  /** The stored rates only: the API never reaches the external source for this call. */
  getLatestRates(): Promise<ApiResult<LatestRatesResponse>>;
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
      const parsed = errorResponseSchema.safeParse(payload);
      if (!parsed.success) return failure('INTERNAL');
      const retryAfterSeconds = readRetryAfterSeconds(response);
      const failed: ApiFailure = {
        ...failure(parsed.data.code),
        ...(parsed.data.fields ? { fields: parsed.data.fields } : {}),
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
          response: movementResponseSchema,
          refreshOnUnauthenticated: true,
        }),
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
  };
}
