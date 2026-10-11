import { AppError } from '@pesly/shared';

/** Opaque keyset cursor shared by the group lists (expenses, settlements). */
export interface Cursor {
  occurredAt: Date;
  id: string;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CURSOR_MAX_LENGTH = 512;

export function encodeCursor(occurredAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ at: occurredAt.toISOString(), id }), 'utf8').toString(
    'base64url',
  );
}

function invalidCursor(): AppError {
  return new AppError('VALIDATION_FAILED', 'Invalid cursor', ['query.cursor']);
}

/** Anything that is not a cursor this adapter produced answers the usual validation error. */
export function decodeCursor(value: string): Cursor {
  if (value.length === 0 || value.length > CURSOR_MAX_LENGTH || !BASE64URL.test(value)) {
    throw invalidCursor();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw invalidCursor();
  const { at, id } = parsed as Record<string, unknown>;
  if (typeof at !== 'string' || typeof id !== 'string' || !UUID.test(id)) throw invalidCursor();
  const occurredAt = new Date(at);
  if (Number.isNaN(occurredAt.getTime()) || occurredAt.toISOString() !== at) throw invalidCursor();
  return { occurredAt, id };
}

/** One page of a `(occurred_at desc, id desc)` list read with `limit + 1` rows. */
export function pageOf<T extends { id: string; occurredAt: Date }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor =
    rows.length > limit && last !== undefined ? encodeCursor(last.occurredAt, last.id) : null;
  return { items, nextCursor };
}
