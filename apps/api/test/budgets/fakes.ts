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
import type { Clock } from '../../src/budgets/application/ports/clock';
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
    version: BudgetVersion,
    monthStart: string,
  ): Promise<Budget | null> {
    await Promise.resolve();
    const row = this.visible(scope, id);
    if (!row) return null;
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
