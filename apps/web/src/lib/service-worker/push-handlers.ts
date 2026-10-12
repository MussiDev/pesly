import { pushPayloadSchema } from '@pesly/shared';

/** The slice of a window client the handlers use; `navigate` is missing in some browsers. */
export interface WindowClientLike {
  url: string;
  focus(): Promise<unknown>;
  navigate?(url: string): Promise<unknown>;
}

export interface NotificationLike {
  close(): void;
  data?: unknown;
}

export interface WorkerDeps {
  showNotification(
    title: string,
    options: { body?: string; tag?: string; data: { url: string } },
  ): Promise<void>;
  /** Window clients only, including the ones the worker does not control yet. */
  matchAll(): Promise<readonly WindowClientLike[]>;
  openWindow(url: string): Promise<unknown>;
  origin: string;
}

const GENERIC_TITLE = 'Pesly';

/** The browser requires a visible notification for every push, so a bad payload still shows one. */
export async function handlePush(text: string | null | undefined, deps: WorkerDeps): Promise<void> {
  const payload = parsePayload(text);
  if (payload === null) {
    await deps.showNotification(GENERIC_TITLE, { data: { url: '/' } });
    return;
  }
  await deps.showNotification(payload.title, {
    body: payload.body,
    tag: payload.noticeId,
    data: { url: payload.url },
  });
}

function parsePayload(text: string | null | undefined) {
  if (typeof text !== 'string' || text === '') return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = pushPayloadSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** Path and query of a same-origin link; anything else is the app root. */
export function resolveTarget(url: unknown, origin: string): string {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return '/';
  if (url.includes('\\')) return '/';
  let resolved: URL;
  try {
    resolved = new URL(url, origin);
  } catch {
    return '/';
  }
  if (resolved.origin !== new URL(origin).origin) return '/';
  return `${resolved.pathname}${resolved.search}`;
}

function readLink(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return undefined;
  return (data as { url?: unknown }).url;
}

function isOwnWindow(client: WindowClientLike, origin: string): boolean {
  try {
    return new URL(client.url).origin === origin;
  } catch {
    return false;
  }
}

export async function handleNotificationClick(
  notification: NotificationLike,
  deps: WorkerDeps,
): Promise<void> {
  notification.close();
  const target = new URL(resolveTarget(readLink(notification.data), deps.origin), deps.origin).href;
  const client = (await deps.matchAll()).find((candidate) => isOwnWindow(candidate, deps.origin));
  if (client) {
    await client.focus();
    if (client.navigate) {
      try {
        await client.navigate(target);
        return;
      } catch {
        // The window cannot be navigated (some browsers refuse it); a new one opens instead.
      }
    }
  }
  await deps.openWindow(target);
}
