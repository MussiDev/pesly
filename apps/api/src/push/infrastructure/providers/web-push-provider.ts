import { isAllowedPushUrl } from '@pesly/shared';
import type { PushMessage, PushOutcome, PushProvider } from '../../application/ports/push-provider';
import { MAX_PLAINTEXT_BYTES, decodeBase64Url, encryptPayload } from './aes128gcm';
import { createVapidAuthorization, type VapidConfig } from './vapid';

const REQUEST_TIMEOUT_MS = 10_000;
const TTL_MAX_SECONDS = 86_400;
const TOPIC_REGEX = /^[A-Za-z0-9_-]{1,32}$/;
const INVALID: PushOutcome = { kind: 'rejected', status: null };

export interface WebPushProviderOptions {
  vapid: VapidConfig;
  fetch?: typeof fetch;
}

/** Parses `Retry-After` as delta-seconds or an HTTP date; a negative or unreadable value is ignored. */
function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  const seconds = Math.ceil((at - Date.now()) / 1000);
  return seconds >= 0 ? seconds : null;
}

function classify(response: Response): PushOutcome {
  const { status } = response;
  if (status === 200 || status === 201 || status === 202) return { kind: 'accepted' };
  if (status === 404 || status === 410) return { kind: 'gone' };
  if (status === 429 || (status >= 500 && status <= 599)) {
    return {
      kind: 'retry',
      status,
      retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')),
    };
  }
  // Redirects, other 4xx and anything unexpected are final so an unknown behaviour never loops.
  return { kind: 'rejected', status };
}

export class WebPushProvider implements PushProvider {
  private readonly vapid: VapidConfig;
  private readonly fetchFn: typeof fetch;

  constructor(options: WebPushProviderOptions) {
    this.vapid = options.vapid;
    this.fetchFn = options.fetch ?? fetch;
  }

  async send(message: PushMessage): Promise<PushOutcome> {
    const { target } = message;
    // Defence in depth against a tampered row.
    if (!isAllowedPushUrl(target.pushUrl)) return INVALID;
    if (!TOPIC_REGEX.test(message.topic)) return INVALID;
    if (
      !Number.isInteger(message.ttlSeconds) ||
      message.ttlSeconds < 0 ||
      message.ttlSeconds > TTL_MAX_SECONDS
    ) {
      return INVALID;
    }
    if (message.body.length > MAX_PLAINTEXT_BYTES) return INVALID;

    let body: Uint8Array;
    let authorization: string;
    try {
      body = encryptPayload({
        plaintext: message.body,
        uaPublic: decodeBase64Url(target.p256dh),
        authSecret: decodeBase64Url(target.auth),
      });
      authorization = await createVapidAuthorization({ ...this.vapid, pushUrl: target.pushUrl });
    } catch {
      // Malformed subscription keys or VAPID keys: final, nothing was sent.
      return INVALID;
    }

    try {
      const response = await this.fetchFn(target.pushUrl, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(message.ttlSeconds),
          Topic: message.topic,
          Urgency: message.urgency,
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return classify(response);
    } catch {
      // Timeout, abort or dropped connection: the caller may try again later.
      return { kind: 'retry', status: null, retryAfterSeconds: null };
    }
  }
}
