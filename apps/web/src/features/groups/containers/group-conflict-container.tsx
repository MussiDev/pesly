'use client';

import {
  splitByBasisPoints,
  splitEqual,
  type GroupExpenseResponse,
  type GroupSplit,
  type SettlementResponse,
} from '@pesly/shared';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '@/i18n/routing';
import { formatDateTime, formatMoney } from '@/lib/format-amount';
import {
  keepMine,
  keepServer,
  readGroupChange,
  withGroupQueue,
  type GroupRecordKind,
  type QueuedGroupChange,
} from '@/lib/local-store/group-queue';
import { readSessionPointer } from '@/lib/local-store/session-pointer';
import { notifyGroupChangeQueued, notifyQueueChanged } from '@/lib/sync/sync-events';
import {
  GroupConflictView,
  type ConflictSide,
  type ConflictSplit,
} from '../components/group-conflict-view';

export interface GroupConflictContainerProps {
  kind: GroupRecordKind;
  id: string;
  /** Display names by id; an id that is missing shows as unknown (the caller owns the group data). */
  memberNames?: Readonly<Record<string, string>>;
  categoryNames?: Readonly<Record<string, string>>;
  /** Asks for a sync pass after "Keep mine"; by default the same signal a queued movement sends. */
  requestSync?: () => void;
  /** Called once a resolution was applied. */
  onResolved?: () => void;
  /** Called when there is nothing to resolve (not queued, no conflict, or no user on the device). */
  onNoConflict?: () => void;
}

type ExpenseChange = Extract<QueuedGroupChange, { kind: 'expense' }>;
type SettlementChange = Extract<QueuedGroupChange, { kind: 'settlement' }>;

type LoadState =
  { phase: 'loading' } | { phase: 'none' } | { phase: 'ready'; change: QueuedGroupChange };

interface Formatting {
  language: Locale;
  timeZone: string;
  memberName: (id: string) => string;
  categoryName: (id: string) => string;
}

type Currency = 'ARS' | 'USD';

/** The shares of a split in minor units; the payer comes first so leftovers go to them. */
function localShares(
  split: GroupSplit,
  total: bigint,
  payerMemberId: string,
): Map<string, bigint> | undefined {
  const payerFirst = <T extends { memberId: string }>(items: T[]): T[] => [
    ...items.filter((item) => item.memberId === payerMemberId),
    ...items.filter((item) => item.memberId !== payerMemberId),
  ];
  try {
    if (split.mode === 'equal') {
      return splitEqual(
        total,
        payerFirst(split.memberIds.map((memberId) => ({ memberId }))).map((item) => item.memberId),
      );
    }
    if (split.mode === 'percentage') return splitByBasisPoints(total, payerFirst(split.shares));
    return new Map(split.shares.map((share) => [share.memberId, BigInt(share.amount)]));
  } catch {
    // A split that does not add up cannot be previewed in amounts: its members still show.
    return undefined;
  }
}

function localSplit(
  split: GroupSplit,
  total: bigint,
  payerMemberId: string,
  currency: Currency,
  format: Formatting,
): ConflictSplit {
  const shares = localShares(split, total, payerMemberId);
  const members =
    split.mode === 'equal' ? split.memberIds : split.shares.map((share) => share.memberId);
  return {
    mode: split.mode,
    rows: members.map((memberId) => {
      const amount = shares?.get(memberId);
      return {
        member: format.memberName(memberId),
        value: amount === undefined ? '' : formatMoney(amount, currency, format.language),
      };
    }),
  };
}

type Sides = { mine: ConflictSide; server: ConflictSide };

function expenseSides(
  change: ExpenseChange,
  server: GroupExpenseResponse,
  format: Formatting,
): Sides {
  const { base, request } = change;
  const money = (amount: string): string =>
    formatMoney(BigInt(amount), base.currency, format.language);
  const date = (iso: string): string => formatDateTime(iso, format.timeZone, format.language);
  const serverSide: ConflictSide = {
    amount: money(server.amount),
    occurredAt: date(server.occurredAt),
    category: format.categoryName(server.categoryId),
    description: server.description,
    split: {
      mode: server.splitMode,
      rows: server.shares.map((share) => ({
        member: format.memberName(share.memberId),
        value: money(share.amount),
      })),
    },
  };
  if (change.operation === 'delete' || request === undefined) {
    return {
      mine: { deleted: true, amount: money(base.amount), occurredAt: date(base.occurredAt) },
      server: serverSide,
    };
  }
  return {
    mine: {
      amount: money(request.amount),
      occurredAt: date(request.occurredAt),
      category: format.categoryName(request.categoryId),
      description: request.description,
      split: localSplit(
        request.split,
        BigInt(request.amount),
        base.payerMemberId,
        base.currency,
        format,
      ),
    },
    server: serverSide,
  };
}

function settlementSides(
  change: SettlementChange,
  server: SettlementResponse,
  format: Formatting,
): Sides {
  const { base, request } = change;
  const money = (amount: string): string =>
    formatMoney(BigInt(amount), base.currency, format.language);
  const date = (iso: string): string => formatDateTime(iso, format.timeZone, format.language);
  const serverSide: ConflictSide = {
    amount: money(server.amount),
    occurredAt: date(server.occurredAt),
  };
  if (change.operation === 'delete' || request === undefined) {
    return {
      mine: { deleted: true, amount: money(base.amount), occurredAt: date(base.occurredAt) },
      server: serverSide,
    };
  }
  return {
    mine: {
      amount: money(request.amount ?? base.amount),
      occurredAt: date(request.occurredAt ?? base.occurredAt),
    },
    server: serverSide,
  };
}

/**
 * Loads the queued change of one group record that is in conflict and lets the person keep their
 * version or the server's. With nothing to resolve it renders nothing and says so.
 */
export function GroupConflictContainer({
  kind,
  id,
  memberNames = {},
  categoryNames = {},
  requestSync = notifyGroupChangeQueued,
  onResolved,
  onNoConflict,
}: GroupConflictContainerProps) {
  const t = useTranslations('groupConflict');
  const locale = useLocale();
  const timeZone = useTimeZone() ?? 'UTC';
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const userId = readSessionPointer()?.userId;

  useEffect(() => {
    let current = true;
    const none = (): void => {
      if (!current) return;
      setState({ phase: 'none' });
      onNoConflict?.();
    };
    if (userId === undefined) {
      none();
    } else {
      void withGroupQueue(userId, (database) => readGroupChange(database, kind, id)).then(
        (change) => {
          if (change?.conflict === undefined) {
            none();
          } else if (current) {
            setState({ phase: 'ready', change });
          }
        },
        // An unreadable local store leaves nothing the person can resolve here.
        none,
      );
    }
    return () => {
      current = false;
    };
  }, [userId, kind, id, onNoConflict]);

  const resolve = useCallback(
    async (choice: 'mine' | 'server') => {
      if (userId === undefined) return;
      setBusy(true);
      setFailed(false);
      try {
        await withGroupQueue(userId, (database) =>
          choice === 'mine' ? keepMine(database, kind, id) : keepServer(database, kind, id),
        );
      } catch {
        // Refused or failed: nothing was written (one transaction), so both versions stay and the
        // person sees the error instead of the cause.
        setFailed(true);
        setBusy(false);
        return;
      }
      setBusy(false);
      notifyQueueChanged();
      if (choice === 'mine') requestSync();
      onResolved?.();
    },
    [userId, kind, id, requestSync, onResolved],
  );

  if (state.phase !== 'ready') return null;

  const format: Formatting = {
    language: locale === 'en' ? 'en' : 'es',
    timeZone,
    memberName: (memberId) => memberNames[memberId] ?? t('unknownMember'),
    categoryName: (categoryId) => categoryNames[categoryId] ?? t('unknownCategory'),
  };
  const { change } = state;
  if (change.conflict === undefined) return null;
  const sides =
    change.kind === 'expense'
      ? expenseSides(change, change.conflict.server, format)
      : settlementSides(change, change.conflict.server, format);

  return (
    <GroupConflictView
      kind={change.kind}
      mine={sides.mine}
      server={sides.server}
      busy={busy}
      failed={failed}
      onKeepMine={() => {
        void resolve('mine');
      }}
      onKeepServer={() => {
        void resolve('server');
      }}
    />
  );
}
