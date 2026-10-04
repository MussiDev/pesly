import { count, sql } from 'drizzle-orm';
import type { TagRepository } from '../../application/ports/tag-repository';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import { tags } from './tags-schema';

/** Makes `\`, `%` and `_` match themselves inside a `like` pattern whose escape is `\`. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export class DrizzleTagRepository implements TagRepository {
  constructor(private readonly db: Database) {}

  async suggest(scope: AccessScope<'read'>, prefix: string, limit: number): Promise<string[]> {
    // The escaped prefix is one bound parameter; the pattern is built in SQL, never by hand.
    const pattern = sql`lower(${escapeLike(prefix)}) || '%'`;
    const rows = await this.db
      .select({ name: tags.name })
      .from(tags)
      .where(
        sql`${scopedTo(scope, { owner: tags.ownerId })} and lower(${tags.name}) like ${pattern} escape '\\'`,
      )
      .orderBy(sql`lower(${tags.name})`)
      .limit(limit);
    return rows.map((row) => row.name);
  }

  async listAll(
    scope: AccessScope<'read'>,
    page: { limit: number; offset: number },
  ): Promise<{ items: string[]; total: number }> {
    const owned = scopedTo(scope, { owner: tags.ownerId });
    const rows = await this.db
      .select({ name: tags.name })
      .from(tags)
      .where(owned)
      .orderBy(sql`lower(${tags.name})`)
      .limit(page.limit)
      .offset(page.offset);
    const [totalRow] = await this.db.select({ total: count() }).from(tags).where(owned);
    return { items: rows.map((row) => row.name), total: totalRow?.total ?? 0 };
  }
}
