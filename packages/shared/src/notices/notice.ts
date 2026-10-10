import { z } from 'zod';
import { calendarDateSchema } from '../credit-cards/credit-card';

export const NOTICE_KINDS = ['reminder', 'recorded', 'not_recorded'] as const;
export const noticeKindSchema = z.enum(NOTICE_KINDS);
export type NoticeKind = z.infer<typeof noticeKindSchema>;

export const NOTICE_LIST_DEFAULT_LIMIT = 20;
export const NOTICE_LIST_MAX_LIMIT = 50;
export const NOTICE_CURSOR_MAX_LENGTH = 200;

export interface NoticeCursor {
  createdAt: string;
  id: string;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const uuidCheck = z.uuid();
const isoCheck = z.iso.datetime();

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// The shared package targets ES2023 with no DOM or Node typings, so the codec is hand-rolled.
// Cursor payloads are ASCII (ISO timestamp and uuid), which keeps it to one byte per character.
function toBase64Url(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 3) {
    const b0 = text.charCodeAt(i);
    const b1 = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
    const b2 = i + 2 < text.length ? text.charCodeAt(i + 2) : 0;
    const chunk = (b0 << 16) | (b1 << 8) | b2;
    out += ALPHABET.charAt((chunk >> 18) & 63);
    out += ALPHABET.charAt((chunk >> 12) & 63);
    if (i + 1 < text.length) out += ALPHABET.charAt((chunk >> 6) & 63);
    if (i + 2 < text.length) out += ALPHABET.charAt(chunk & 63);
  }
  return out;
}

function fromBase64Url(value: string): string | null {
  if (value.length % 4 === 1) return null;
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const char of value) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return null;
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      const byte = (buffer >> bits) & 255;
      if (byte > 127) return null;
      out += String.fromCharCode(byte);
    }
  }
  return out;
}

/** Opaque keyset cursor: base64url of `{ createdAt, id }`. */
export function encodeNoticeCursor(cursor: NoticeCursor): string {
  return toBase64Url(JSON.stringify({ createdAt: cursor.createdAt, id: cursor.id }));
}

/** Returns `null` for anything that is not a cursor produced by `encodeNoticeCursor`. */
export function decodeNoticeCursor(value: string): NoticeCursor | null {
  if (value.length === 0 || value.length > NOTICE_CURSOR_MAX_LENGTH || !BASE64URL.test(value)) {
    return null;
  }
  const json = fromBase64Url(value);
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const { createdAt, id } = parsed as Record<string, unknown>;
  if (!isoCheck.safeParse(createdAt).success || !uuidCheck.safeParse(id).success) return null;
  return { createdAt: createdAt as string, id: id as string };
}

/** `GET /notices`. */
export const listNoticesQuerySchema = z.strictObject({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(NOTICE_LIST_MAX_LIMIT)
    .default(NOTICE_LIST_DEFAULT_LIMIT),
  cursor: z
    .string()
    .max(NOTICE_CURSOR_MAX_LENGTH)
    .refine((value) => decodeNoticeCursor(value) !== null, { message: 'Invalid cursor' })
    .optional(),
});

export type ListNoticesQuery = z.infer<typeof listNoticesQuerySchema>;

export const noticeSchema = z.object({
  id: z.string(),
  kind: noticeKindSchema,
  text: z.string(),
  dueDate: calendarDateSchema,
  createdAt: z.string(),
  readAt: z.string().nullable(),
});

export type Notice = z.infer<typeof noticeSchema>;

export const listNoticesResponseSchema = z.object({
  items: z.array(noticeSchema),
  nextCursor: z.string().nullable(),
  unreadCount: z.number().int().min(0),
});

export type ListNoticesResponse = z.infer<typeof listNoticesResponseSchema>;

export const noticeIdParamsSchema = z.object({ id: z.uuid() });
export type NoticeIdParams = z.infer<typeof noticeIdParamsSchema>;

export const markAllReadResponseSchema = z.object({ unreadCount: z.literal(0) });
export type MarkAllReadResponse = z.infer<typeof markAllReadResponseSchema>;
