import type { ActivityEntry, ExpenseSnapshot, SettlementSnapshot } from '@pesly/shared';
import { formatDateTime, formatMoney } from '@/lib/format-amount';
import type { Locale } from '@/i18n/routing';

export interface ActivityViewNames {
  members: ReadonlyArray<{ id: string; displayName: string | null }>;
  formerMembers: ReadonlyArray<{ id: string; displayName: string | null }>;
}

export interface ActivityViewContext {
  language: Locale;
  timeZone: string;
  /** Copy for a member without a name (unnamed, ghost or unknown id). */
  unnamed: string;
  /** Copy for a category that is not (yet) known. */
  neutralCategory: string;
  /** Optional display text per split mode; the mode code is shown when absent. */
  splitModeLabels?: Partial<Record<ExpenseSnapshot['splitMode'], string>>;
}

/** The `field` is a key under `groups.activity.fields`. Values are plain strings, never markup. */
export interface ActivityDetail {
  field: string;
  before: string | null;
  after: string | null;
}

export interface ActivityRowView {
  id: string;
  /** `groups.activity.actions.<action>` */
  action: ActivityEntry['action'];
  /** `groups.activity.kinds.<kind>` */
  kind: ActivityEntry['subjectType'];
  memberName: string;
  createdAt: string;
  details: ActivityDetail[];
  fromMovement: boolean;
  autoCategory: ActivityEntry['autoCategory'];
}

/** `raw` is what the diff compares, so two different unknown ids still count as a change. */
type Field = { field: string; value: string; raw: string };

const isExpense = (s: ExpenseSnapshot | SettlementSnapshot | null): s is ExpenseSnapshot =>
  s !== null && 'splitMode' in s;
const isSettlement = (s: ExpenseSnapshot | SettlementSnapshot | null): s is SettlementSnapshot =>
  s !== null && 'fromMemberId' in s;

const f = (field: string, value: string, raw: string = value): Field => ({ field, value, raw });

function safeBigInt(value: string): bigint | null {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function buildActivityView(
  entries: readonly ActivityEntry[],
  names: ActivityViewNames,
  categories: ReadonlyArray<{ id: string; name: string }>,
  context: ActivityViewContext,
): ActivityRowView[] {
  const memberNames = new Map<string, string | null>();
  for (const m of names.formerMembers) memberNames.set(m.id, m.displayName);
  for (const m of names.members) memberNames.set(m.id, m.displayName);
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

  const memberName = (id: string): string => memberNames.get(id) ?? context.unnamed;
  const money = (amount: string, currency: 'ARS' | 'USD'): string => {
    const minor = safeBigInt(amount);
    return minor === null ? amount : formatMoney(minor, currency, context.language);
  };
  const date = (iso: string): string => formatDateTime(iso, context.timeZone, context.language);

  const expenseFields = (s: ExpenseSnapshot): Field[] => [
    f('amount', money(s.amount, s.currency)),
    f('currency', s.currency),
    f('date', date(s.occurredAt)),
    f('category', categoryNames.get(s.categoryId) ?? context.neutralCategory, s.categoryId),
    f('description', s.description),
    f('splitMode', context.splitModeLabels?.[s.splitMode] ?? s.splitMode),
    f('payer', memberName(s.payerMemberId)),
    f(
      'shares',
      s.shares
        .map((share) => `${memberName(share.memberId)}: ${money(share.amount, s.currency)}`)
        .join(', '),
    ),
  ];

  const settlementFields = (s: SettlementSnapshot): Field[] => [
    f('from', memberName(s.fromMemberId)),
    f('to', memberName(s.toMemberId)),
    f('currency', s.currency),
    f('amount', money(s.amount, s.currency)),
    f('date', date(s.occurredAt)),
    f('legs', s.legs.map((leg) => money(leg.amount, leg.currency)).join(', ')),
  ];

  const fieldsOf = (
    snapshot: ExpenseSnapshot | SettlementSnapshot | null,
    kind: ActivityEntry['subjectType'],
  ): Field[] | null => {
    if (kind === 'expense' && isExpense(snapshot)) return expenseFields(snapshot);
    if (kind === 'settlement' && isSettlement(snapshot)) return settlementFields(snapshot);
    return null;
  };

  const detailsOf = (entry: ActivityEntry): ActivityDetail[] => {
    if (entry.action.endsWith('_updated')) {
      const before = fieldsOf(entry.before, entry.subjectType);
      const after = fieldsOf(entry.after, entry.subjectType);
      if (before === null || after === null) return [];
      const previous = new Map(before.map((f) => [f.field, f]));
      return after
        .filter((f) => previous.get(f.field)?.raw !== f.raw)
        .map((f) => ({
          field: f.field,
          before: previous.get(f.field)?.value ?? null,
          after: f.value,
        }));
    }
    if (entry.action.endsWith('_deleted')) {
      const before = fieldsOf(entry.before, entry.subjectType);
      return (before ?? []).map((f) => ({ field: f.field, before: f.value, after: null }));
    }
    return [];
  };

  return entries.map((entry) => ({
    id: entry.id,
    action: entry.action,
    kind: entry.subjectType,
    memberName: memberName(entry.memberId),
    createdAt: entry.createdAt,
    details: detailsOf(entry),
    fromMovement: entry.fromMovement,
    autoCategory: entry.autoCategory,
  }));
}

/** Appends a page to what is shown and drops any entry whose id is already shown. */
export function mergeActivityPages(
  shown: readonly ActivityEntry[],
  page: readonly ActivityEntry[],
): ActivityEntry[] {
  const seen = new Set(shown.map((e) => e.id));
  const merged = [...shown];
  for (const entry of page) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
  }
  return merged;
}
