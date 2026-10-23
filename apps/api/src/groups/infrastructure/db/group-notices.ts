import { dateInTimeZone } from '@pesly/shared';
import { and, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { notices, users } from './foreign-relations';
import type { GroupTx } from './group-locks';
import { groupMembers, groups } from './schema';

export type GroupNoticeKind = 'group_expense' | 'group_settlement';

export interface GroupNoticeTextParams {
  kind: GroupNoticeKind;
  language: 'es' | 'en';
  groupName: string;
  /** Null when the member who recorded it has no display name. */
  actorName: string | null;
}

/** Renders the stored notice text; injected so this module does not import the notices domain. */
export type RenderGroupNoticeText = (input: GroupNoticeTextParams) => string;

export interface GroupNoticesToPublish {
  kind: GroupNoticeKind;
  groupId: string;
  /** The expense or settlement id. */
  subjectId: string;
  /** The caller's member: never notified about their own record. */
  actorMemberId: string;
  /** Every member the record involves; ghosts, former members and the actor are left out here. */
  memberIds: readonly string[];
  at: Date;
}

/**
 * One notice per registered, active member the record involves, in the caller's transaction, so a
 * rolled back write leaves no notice. The push job fans them out to the members' devices. The due
 * date is the day of `at` in each recipient's time zone.
 */
export async function publishGroupNotices(
  tx: GroupTx,
  render: RenderGroupNoticeText,
  data: GroupNoticesToPublish,
): Promise<number> {
  const memberIds = [...new Set(data.memberIds)];
  if (memberIds.length === 0) return 0;
  const [actor] = await tx
    .select({
      userId: groupMembers.userId,
      name: sql<string | null>`coalesce(${groupMembers.displayName}, ${users.displayName})`,
      groupName: groups.name,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .leftJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(groupMembers.id, data.actorMemberId), eq(groupMembers.groupId, data.groupId)))
    .limit(1);
  if (!actor) return 0;

  const recipients = await tx
    .selectDistinct({ userId: users.id, language: users.language, timeZone: users.timeZone })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(
      and(
        eq(groupMembers.groupId, data.groupId),
        inArray(groupMembers.id, memberIds),
        isNull(groupMembers.leftAt),
        isNotNull(groupMembers.userId),
        actor.userId === null ? undefined : ne(users.id, actor.userId),
      ),
    );
  if (recipients.length === 0) return 0;

  const rows = await tx
    .insert(notices)
    .values(
      recipients.map((recipient) => ({
        ownerId: recipient.userId,
        kind: data.kind,
        paymentId: data.subjectId,
        groupId: data.groupId,
        // In TypeScript, not SQL: PostgreSQL does not know every zone name that Intl accepts.
        dueDate: dateInTimeZone(data.at, recipient.timeZone),
        text: render({
          kind: data.kind,
          language: recipient.language,
          groupName: actor.groupName,
          actorName: actor.name,
        }),
      })),
    )
    .onConflictDoNothing({
      target: [notices.ownerId, notices.kind, notices.paymentId, notices.dueDate],
    })
    .returning({ id: notices.id });
  return rows.length;
}
