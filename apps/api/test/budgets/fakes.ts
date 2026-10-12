import { randomUUID } from 'node:crypto';
import { BUDGET_LIMIT_PER_USER, type CategoryKind } from '@pesly/shared';
import type { Budget, BudgetVersion } from '../../src/budgets/domain/budget';
import { versionInForce } from '../../src/budgets/domain/budget';
import { BudgetLimitReached } from '../../src/budgets/domain/errors';
import type {
  BudgetRepository,
  NewBudget,
} from '../../src/budgets/application/ports/budget-repository';
import type {
  BudgetCategoryRef,
  CategoryReader,
} from '../../src/budgets/application/ports/category-reader';
import type {
  BudgetVersionReader,
  BudgetVersions,
  CoveredCategory,
  VersionInForce,
} from '../../src/budgets/application/ports/budget-version-reader';
import type {
  AlertCrossing,
  BudgetAlertStore,
} from '../../src/budgets/application/ports/budget-alert-store';
import type { Clock } from '../../src/budgets/application/ports/clock';
import type {
  BucketedPersonalRow,
  BucketedShareRow,
  SpendingReader,
  SpendingWindow,
} from '../../src/budgets/application/ports/spending-reader';
import type { UserTimeZone } from '../../src/budgets/application/ports/user-time-zone';
import { OwnerOrGroupMemberAccessPolicy, type AccessScope } from '../../src/shared/access';
import { DenyAllGroupMembershipReader } from '../../src/shared/access/infrastructure/deny-all-group-membership-reader';

const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());

export function writeScopeFor(userId: string): Promise<AccessScope<'write'>> {
  return policy.scopeFor({ userId, sessionId: 'session', emailVerified: true }, 'write');
}

export function readScopeFor(userId: string): Promise<AccessScope<'read'>> {
  return policy.scopeFor({ userId, sessionId: 'session', emailVerified: true }, 'read');
}

export class FixedClock implements Clock {
  constructor(public current: Date) {}
  now(): Date {
    return this.current;
  }
}

export class FakeUserTimeZone implements UserTimeZone {
  constructor(private readonly zone = 'America/Argentina/Buenos_Aires') {}
  timeZoneOf(): Promise<string> {
    return Promise.resolve(this.zone);
  }
}

export interface FakeCategory {
  id: string;
  ownerId: string;
  kind: CategoryKind;
  archived: boolean;
  parentId: string | null;
  /** Custom name; null while a default is untouched. */
  name: string | null;
  defaultKey: string | null;
}

/** The callers' categories, shared by the reader and the repository fake (for the covered set). */
export class FakeCategories implements CategoryReader {
  readonly rows = new Map<string, FakeCategory>();

  add(ownerId: string, overrides: Partial<FakeCategory> = {}): FakeCategory {
    const category: FakeCategory = {
      id: randomUUID(),
      ownerId,
      kind: 'expense',
      archived: false,
      parentId: null,
      name: null,
      defaultKey: null,
      ...overrides,
    };
    this.rows.set(category.id, category);
    return category;
  }

  findMany(scope: AccessScope, ids: readonly string[]): Promise<BudgetCategoryRef[]> {
    const found: BudgetCategoryRef[] = [];
    for (const id of ids) {
      const row = this.rows.get(id);
      if (row?.ownerId === scope.userId) {
        found.push({ id: row.id, kind: row.kind, archived: row.archived });
      }
    }
    return Promise.resolve(found);
  }

  coveredBy(ownerId: string, selected: readonly string[]): string[] {
    const covered = new Set(selected);
    for (const row of this.rows.values()) {
      if (row.ownerId === ownerId && row.parentId !== null && selected.includes(row.parentId)) {
        covered.add(row.id);
      }
    }
    return [...covered];
  }
}

interface Row {
  id: string;
  ownerId: string;
  currency: Budget['currency'];
  createdAt: Date;
  versions: BudgetVersion[];
}

/** In-memory repository mirroring the Drizzle one: scoped reads, version per month, 50 per owner. */
export class InMemoryBudgetRepository implements BudgetRepository {
  readonly rows = new Map<string, Row>();
  private tick = 0;

  constructor(private readonly categories: FakeCategories) {}

  async create(scope: AccessScope<'write'>, data: NewBudget, monthStart: string): Promise<Budget> {
    await Promise.resolve();
    const owned = [...this.rows.values()].filter((row) => row.ownerId === scope.userId);
    if (owned.length >= BUDGET_LIMIT_PER_USER) throw new BudgetLimitReached();
    const row: Row = {
      id: randomUUID(),
      ownerId: scope.userId,
      currency: data.currency,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, this.tick++)),
      versions: [clone(data.version)],
    };
    this.rows.set(row.id, row);
    return this.read(row, monthStart);
  }

  async findById(scope: AccessScope, id: string, monthStart: string): Promise<Budget | null> {
    await Promise.resolve();
    const row = this.visible(scope, id);
    return row ? this.read(row, monthStart) : null;
  }

  async listCurrent(scope: AccessScope, monthStart: string): Promise<Budget[]> {
    await Promise.resolve();
    return [...this.rows.values()]
      .filter((row) => row.ownerId === scope.userId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .map((row) => this.read(row, monthStart));
  }

  async update(
    scope: AccessScope<'write'>,
    id: string,
    monthStart: string,
    change: (current: BudgetVersion) => BudgetVersion,
  ): Promise<Budget | null> {
    await Promise.resolve();
    const row = this.visible(scope, id);
    if (!row) return null;
    const version = change(this.read(row, monthStart).version);
    row.versions = [
      ...row.versions.filter((existing) => existing.effectiveFrom !== version.effectiveFrom),
      clone(version),
    ];
    return this.read(row, monthStart);
  }

  async delete(scope: AccessScope<'write'>, id: string): Promise<boolean> {
    await Promise.resolve();
    return this.visible(scope, id) ? this.rows.delete(id) : false;
  }

  private visible(scope: AccessScope, id: string): Row | null {
    const row = this.rows.get(id);
    return row?.ownerId === scope.userId ? row : null;
  }

  private read(row: Row, monthStart: string): Budget {
    const earliest = [...row.versions].sort((a, b) =>
      a.effectiveFrom.localeCompare(b.effectiveFrom),
    )[0];
    const version = versionInForce(row.versions, monthStart) ?? earliest;
    if (!version) throw new Error('A budget always has a version');
    return {
      id: row.id,
      ownerId: row.ownerId,
      currency: row.currency,
      createdAt: row.createdAt,
      version: clone(version),
      coveredCategoryIds: this.categories.coveredBy(row.ownerId, version.categoryIds),
    };
  }
}

function clone(version: BudgetVersion): BudgetVersion {
  return { ...version, categoryIds: [...version.categoryIds], thresholds: [...version.thresholds] };
}

/** Reads the versions of the in-memory repository the way the Drizzle reader does (D3, D12). */
export class InMemoryVersionReader implements BudgetVersionReader {
  readonly calls: { months: readonly string[]; budgetId?: string }[] = [];

  constructor(
    private readonly repo: InMemoryBudgetRepository,
    private readonly categories: FakeCategories,
  ) {}

  async forMonths(
    scope: AccessScope,
    months: readonly string[],
    budgetId?: string,
  ): Promise<BudgetVersions[]> {
    await Promise.resolve();
    this.calls.push({ months, budgetId });
    return [...this.repo.rows.values()]
      .filter(
        (row) => row.ownerId === scope.userId && (budgetId === undefined || row.id === budgetId),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .map((row) => ({
        budgetId: row.id,
        currency: row.currency,
        createdAt: row.createdAt,
        byMonth: new Map(
          months.map((month) => [month, this.version(row.ownerId, row.versions, month)]),
        ),
      }));
  }

  private version(
    ownerId: string,
    versions: BudgetVersion[],
    month: string,
  ): VersionInForce | null {
    const version = versionInForce(versions, `${month}-01`);
    if (!version) return null;
    const covered: CoveredCategory[] = [];
    for (const id of this.categories.coveredBy(ownerId, version.categoryIds)) {
      const row = this.categories.rows.get(id);
      if (row) covered.push({ id: row.id, name: row.name, defaultKey: row.defaultKey });
    }
    return {
      version: {
        ...version,
        categoryIds: [...version.categoryIds],
        thresholds: [...version.thresholds],
      },
      covered,
    };
  }
}

/** Scripted spending rows per owner; counts every call so tests can assert "one call" or "none". */
export class FakeSpendingReader implements SpendingReader {
  readonly personal = new Map<string, BucketedPersonalRow[]>();
  readonly shares = new Map<string, BucketedShareRow[]>();
  readonly personalCalls: { window: SpendingWindow; categoryIds: readonly string[] }[] = [];
  readonly shareCalls: { window: SpendingWindow }[] = [];

  async personalSpending(
    scope: AccessScope,
    window: SpendingWindow,
    categoryIds: readonly string[],
  ): Promise<BucketedPersonalRow[]> {
    await Promise.resolve();
    this.personalCalls.push({ window, categoryIds });
    return (this.personal.get(scope.userId) ?? []).filter((row) =>
      categoryIds.includes(row.categoryId),
    );
  }

  async shareSpending(scope: AccessScope, window: SpendingWindow): Promise<BucketedShareRow[]> {
    await Promise.resolve();
    this.shareCalls.push({ window });
    return this.shares.get(scope.userId) ?? [];
  }
}

/** Records the crossings it was given; a crossing already marked is not published again. */
export class InMemoryAlertStore implements BudgetAlertStore {
  readonly calls: { userId: string; crossings: AlertCrossing[] }[] = [];
  readonly marks = new Set<string>();
  readonly published: AlertCrossing[] = [];

  async publish(scope: AccessScope, crossings: readonly AlertCrossing[]): Promise<number> {
    await Promise.resolve();
    this.calls.push({ userId: scope.userId, crossings: [...crossings] });
    let created = 0;
    for (const crossing of crossings) {
      const key = `${crossing.budgetId}|${crossing.month}|${crossing.threshold}`;
      if (this.marks.has(key)) continue;
      this.marks.add(key);
      this.published.push(crossing);
      created += 1;
    }
    return created;
  }
}
