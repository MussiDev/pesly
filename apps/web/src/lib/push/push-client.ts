/** What the API stores: the endpoint and the two keys, nothing else. */
export interface BrowserPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type SubscribeResult =
  { ok: true; subscription: BrowserPushSubscription } | { ok: false; reason: 'denied' | 'error' };

function toBody(subscription: PushSubscription): BrowserPushSubscription | null {
  const json = subscription.toJSON();
  const { endpoint, keys } = json;
  if (!endpoint || !keys?.p256dh || !keys.auth) return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

function decodeKey(publicKey: string): Uint8Array<ArrayBuffer> {
  const base64 = publicKey.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pushManager(): Promise<PushManager> {
  return (await navigator.serviceWorker.ready).pushManager;
}

/** The browser's current subscription, or `null` when there is none (or it cannot be read). */
export async function readSubscription(): Promise<BrowserPushSubscription | null> {
  try {
    const subscription = await (await pushManager()).getSubscription();
    return subscription === null ? null : toBody(subscription);
  } catch {
    return null;
  }
}

/** The only place that asks the notification permission and creates a subscription. */
export async function subscribe(publicKey: string): Promise<SubscribeResult> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: 'denied' };
    const subscription = await (
      await pushManager()
    ).subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(publicKey) });
    const body = toBody(subscription);
    if (body === null) {
      await subscription.unsubscribe().catch(() => false);
      return { ok: false, reason: 'error' };
    }
    return { ok: true, subscription: body };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** `true` when no subscription remains in the browser. */
export async function unsubscribe(): Promise<boolean> {
  try {
    const subscription = await (await pushManager()).getSubscription();
    return subscription === null ? true : await subscription.unsubscribe();
  } catch {
    return false;
  }
}
