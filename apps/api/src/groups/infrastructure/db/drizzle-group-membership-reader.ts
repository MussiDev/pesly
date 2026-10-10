import { asc, eq } from 'drizzle-orm';
import type { GroupMembershipReader } from '../../../shared/access/group-membership-reader';
import type { Database } from '../../../shared/db/client';
import { groupMembers } from './schema';

/** Exported for DISC-001-05b, which wires it where the first shared resource appears (spec D12). */
export class DrizzleGroupMembershipReader implements GroupMembershipReader {
  constructor(private readonly db: Database) {}

  async groupIdsOf(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId))
      .orderBy(asc(groupMembers.groupId));
    return rows.map((row) => row.groupId);
  }
}
