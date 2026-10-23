import { z } from 'zod';

export const PUSH_MAX_SUBSCRIPTIONS = 10;
export const PUSH_TTL_SECONDS = 21600;
export const PUSH_PAYLOAD_MAX_BYTES = 3000;
export const PUSH_MAX_ATTEMPTS = 5;

const ENDPOINT_MAX_LENGTH = 2048;

// Allowed push service hosts; a wildcard needs at least one label before the suffix.
export const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  '*.push.services.mozilla.com',
  '*.push.apple.com',
  '*.notify.windows.com',
] as const;

function hostPattern(host: string): string {
  const escape = (s: string) => s.replace(/\./g, '\\.');
  return host.startsWith('*.') ? `(?:[a-z0-9-]+\\.)+${escape(host.slice(2))}` : escape(host);
}

const URL_SAFE = "[A-Za-z0-9\\-._~!$&'()*+,;=:@%/]";
// The host must be followed directly by "/", so user-info, ports, IPs and trailing dots fail.
const PUSH_URL_REGEX = new RegExp(
  `^https://(?:${PUSH_SERVICE_HOSTS.map(hostPattern).join('|')})/${URL_SAFE}*(?:\\?${URL_SAFE}*)?$`,
);

export function isAllowedPushUrl(value: unknown): boolean {
  return (
    typeof value === 'string' && value.length <= ENDPOINT_MAX_LENGTH && PUSH_URL_REGEX.test(value)
  );
}

// 65 bytes = 87 chars; the last char carries 2 padding bits that must be zero.
const P256DH_REGEX = /^[A-Za-z0-9_-]{86}[AEIMQUYcgkosw048]$/;
// 16 bytes = 22 chars; the last char carries 4 padding bits that must be zero.
const AUTH_REGEX = /^[A-Za-z0-9_-]{21}[AQgw]$/;

export const pushSubscriptionRequestSchema = z.object({
  endpoint: z.string().max(ENDPOINT_MAX_LENGTH).refine(isAllowedPushUrl),
  keys: z.object({
    p256dh: z.string().regex(P256DH_REGEX),
    auth: z.string().regex(AUTH_REGEX),
  }),
});
export type PushSubscriptionRequest = z.infer<typeof pushSubscriptionRequestSchema>;

export const unsubscribeRequestSchema = z.object({
  endpoint: z.string().min(1).max(ENDPOINT_MAX_LENGTH),
});
export type UnsubscribeRequest = z.infer<typeof unsubscribeRequestSchema>;

export const pushSubscriptionResponseSchema = z.object({ id: z.uuid() });
export type PushSubscriptionResponse = z.infer<typeof pushSubscriptionResponseSchema>;

export const pushConfigResponseSchema = z
  .object({
    available: z.boolean(),
    publicKey: z.string().min(1).nullable(),
  })
  .refine((c) => c.available === (c.publicKey !== null));
export type PushConfigResponse = z.infer<typeof pushConfigResponseSchema>;

export const pushPayloadSchema = z.object({
  noticeId: z.uuid(),
  title: z.string().min(1).max(40),
  body: z.string().max(300),
  url: z.string().regex(/^\/(?!\/)[^\\]*$/),
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;

export function pushNoticesLink(language: 'es' | 'en'): string {
  return `/${language}/notices`;
}

/** The detail of the group a group notice is about. */
export function pushGroupLink(language: 'es' | 'en', groupId: string): string {
  return `/${language}/groups/${encodeURIComponent(groupId)}`;
}
