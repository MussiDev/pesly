import { randomUUID } from 'node:crypto';
import type { AccountCurrency, AccountType } from '@pesly/shared';
import type { Account } from '../../src/accounts/domain/account';
import { AccountNameTaken } from '../../src/accounts/domain/errors';
import type {
  AccountRepository,
  ActiveAccount,
  CreateAccountData,
  SetIncludeInAvailableResult,
} from '../../src/accounts/application/ports/account-repository';
import type { AccountLinks } from '../../src/accounts/application/ports/account-links';
import type { AccountMovements } from '../../src/accounts/application/ports/account-movements';
import { OwnerOrGroupMemberAccessPolicy, type AccessScope } from '../../src/shared/access';
import { DenyAllGroupMembershipReader } from '../../src/shared/access/infrastructure/deny-all-group-membership-reader';

const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());

export function writeScopeFor(userId: string): Promise<AccessScope<'write'>> {
  return policy.scopeFor({ userId, sessionId: 'session', emailVerified: true }, 'write');
}

export function readScopeFor(userId: string): Promise<AccessScope<'read'>> {
  return policy.scopeFor({ userId, sessionId: 'session', emailVerified: true }, 'read');
}

interface Row {
  ownerId: string;
  account: Account;
}

/** In-memory repository: rows are visible only to their owner; names are unique per owner, ignoring case. */
export class InMemoryAccountRepository implements AccountRepository {
  readonly rows = new Map<string, Row>();
  /** When set, `delete` throws it, like the database foreign-key backstop does. */
  deleteError: Error | null = null;
  private clock = 0;

  async create(scope: AccessScope<'write'>, data: CreateAccountData): Promise<Account> {
    await Promise.resolve();
    this.assertNameFree(scope.userId, data.name, null);
    const account: Account = {
      id: randomUUID(),
      name: data.name,
      type: data.type,
      currency: data.currency,
      openingBalance: data.openingBalance,
      includeInAvailable: data.includeInAvailable ?? false,
      archivedAt: null,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock++)),
    };
    this.rows.set(account.id, { ownerId: scope.userId, account });
    return account;
  }

  async findById(scope: AccessScope, id: string): Promise<Account | null> {
    await Promise.resolve();
    return this.visible(scope, id)?.account ?? null;
  }

  async list(
    scope: AccessScope,
    options: { archived: boolean; limit: number; offset: number },
  ): Promise<{ items: Account[]; total: number }> {
    await Promise.resolve();
    const matching = this.ownedBy(scope).filter(
      (account) => (account.archivedAt !== null) === options.archived,
    );
    return {
      items: matching.slice(options.offset, options.offset + options.limit),
      total: matching.length,
    };
  }

  async listActive(scope: AccessScope): Promise<ActiveAccount[]> {
    await Promise.resolve();
    return this.ownedBy(scope)
      .filter((account) => account.archivedAt === null)
      .map(({ id, type, currency, openingBalance, includeInAvailable }) => ({
        id,
        type,
        currency,
        openingBalance,
        includeInAvailable,
      }));
  }

  async rename(scope: AccessScope<'write'>, id: string, name: string): Promise<Account | null> {
    await Promise.resolve();
    const row = this.visible(scope, id);
    if (!row) return null;
    this.assertNameFree(scope.userId, name, id);
    row.account = { ...row.account, name };
    return row.account;
  }

  async setArchived(
    scope: AccessScope<'write'>,
    id: string,
    archived: boolean,
  ): Promise<Account | null> {
    await Promise.resolve();
    const row = this.visible(scope, id);
    if (!row) return null;
    if (archived !== (row.account.archivedAt !== null)) {
      row.account = {
        ...row.account,
        archivedAt: archived ? new Date(Date.UTC(2026, 5, 1)) : null,
      };
    }
    return row.account;
  }

  /** Mirrors the real repository: card first, then archived; an equal value writes nothing. */
  async setIncludeInAvailable(
    scope: AccessScope<'write'>,
    id: string,
    value: boolean,
  ): Promise<SetIncludeInAvailableResult> {
    await Promise.resolve();
    const row = this.visible(scope, id);
    if (!row) return { status: 'not_found' };
    if (row.account.type === 'credit_card') return { status: 'credit_card' };
    if (row.account.archivedAt !== null) return { status: 'archived' };
    if (row.account.includeInAvailable !== value) {
      row.account = { ...row.account, includeInAvailable: value };
    }
    return { status: 'updated', account: row.account };
  }

  async delete(scope: AccessScope<'write'>, id: string): Promise<boolean> {
    await Promise.resolve();
    if (this.deleteError) throw this.deleteError;
    if (!this.visible(scope, id)) return false;
    this.rows.delete(id);
    return true;
  }

  /** Test helper: inserts an account straight into the store for any owner. */
  seed(
    ownerId: string,
    data: {
      name: string;
      type?: AccountType;
      currency?: AccountCurrency;
      openingBalance?: bigint;
      includeInAvailable?: boolean;
      archived?: boolean;
    },
  ): Account {
    const account: Account = {
      id: randomUUID(),
      name: data.name,
      type: data.type ?? 'bank_account',
      currency: data.currency ?? 'ARS',
      openingBalance: data.openingBalance ?? 0n,
      includeInAvailable: data.type === 'credit_card' ? false : (data.includeInAvailable ?? true),
      archivedAt: data.archived ? new Date(Date.UTC(2026, 5, 1)) : null,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock++)),
    };
    this.rows.set(account.id, { ownerId, account });
    return account;
  }

  private visible(scope: AccessScope, id: string): Row | undefined {
    const row = this.rows.get(id);
    return row && row.ownerId === scope.userId ? row : undefined;
  }

  private ownedBy(scope: AccessScope): Account[] {
    return [...this.rows.values()]
      .filter((row) => row.ownerId === scope.userId)
      .map((row) => row.account)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  private assertNameFree(ownerId: string, name: string, exceptId: string | null): void {
    const wanted = name.toLowerCase();
    for (const [id, row] of this.rows) {
      if (id !== exceptId && row.ownerId === ownerId && row.account.name.toLowerCase() === wanted) {
        throw new AccountNameTaken();
      }
    }
  }
}

/** Configurable movements port: per-account sums, a set of accounts that "have movements", or a failure. */
/** Accounts reported as linked to a credit card. */
export class FakeAccountLinks implements AccountLinks {
  readonly linked = new Set<string>();

  isLinked(accountId: string): Promise<boolean> {
    return Promise.resolve(this.linked.has(accountId));
  }
}

export class FakeAccountMovements implements AccountMovements {
  readonly sums = new Map<string, bigint>();
  readonly used = new Set<string>();
  readonly sumCalls: string[][] = [];
  failure: Error | null = null;

  async sumsByAccount(accountIds: readonly string[]): Promise<ReadonlyMap<string, bigint>> {
    await Promise.resolve();
    this.sumCalls.push([...accountIds]);
    if (this.failure) throw this.failure;
    const result = new Map<string, bigint>();
    for (const id of accountIds) {
      const sum = this.sums.get(id);
      if (sum !== undefined) result.set(id, sum);
    }
    return result;
  }

  async hasMovements(accountId: string): Promise<boolean> {
    await Promise.resolve();
    if (this.failure) throw this.failure;
    return this.used.has(accountId);
  }
}
