import { databaseTimeZone } from '@pesly/shared';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { and, eq, gte, inArray, lt, notExists, sql, type SQL } from 'drizzle-orm';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import type { FlowWindow } from '../../application/ports/flow-reader';
import { groupExpenses, movements, movementTags, tags } from './foreign-relations';

/** The instants are bound as ISO text, so the driver never formats a `Date` in the server zone. */
export const instant = (value: Date) => sql`${value.toISOString()}::timestamptz`;

/** `YYYY-MM` of a timestamp in the user's zone; the zone is a bound parameter. */
export const monthIn = (column: AnyPgColumn, timeZone: string) =>
  sql<string>`to_char(${column} at time zone ${databaseTimeZone(timeZone)}, 'YYYY-MM')`;

/**
 * The WHERE of the personal read, in one place: the owner, expense and income only, the window,
 * the payer movement of a group expense left out (its share counts instead), and the optional
 * account and tag filters. The tag is compared with `lower()` and always a bound parameter.
 */
export function personalConditions(
  db: Database,
  scope: AccessScope,
  window: FlowWindow,
): SQL | undefined {
  return and(
    scopedTo(scope, { owner: movements.ownerId }),
    inArray(movements.type, ['expense', 'income']),
    gte(movements.occurredAt, instant(window.from)),
    lt(movements.occurredAt, instant(window.before)),
    notExists(
      db
        .select({ one: sql`1` })
        .from(groupExpenses)
        .where(eq(groupExpenses.payerMovementId, movements.id)),
    ),
    window.accountId === undefined ? undefined : eq(movements.accountId, window.accountId),
    window.tag === undefined
      ? undefined
      : sql`exists (
          select 1 from ${movementTags}
          join ${tags} on ${tags.id} = ${movementTags.tagId} and ${tags.ownerId} = ${movementTags.ownerId}
          where ${movementTags.movementId} = ${movements.id}
            and ${movementTags.ownerId} = ${movements.ownerId}
            and lower(${tags.name}) = lower(${window.tag})
        )`,
  );
}
