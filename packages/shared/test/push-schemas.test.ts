import { describe, expect, it } from 'vitest';
import {
  PUSH_MAX_ATTEMPTS,
  PUSH_MAX_SUBSCRIPTIONS,
  PUSH_PAYLOAD_MAX_BYTES,
  PUSH_TTL_SECONDS,
  isAllowedPushUrl,
  pushConfigResponseSchema,
  pushGroupLink,
  pushNoticesLink,
  pushPayloadSchema,
  pushSubscriptionRequestSchema,
  unsubscribeRequestSchema,
} from '../src/push';

const P256DH = `B${'A'.repeat(85)}A`; // 87 chars, canonical last char
const AUTH = `${'A'.repeat(21)}A`; // 22 chars
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';

describe('isAllowedPushUrl', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])('accepts %s', (url) => {
    expect(isAllowedPushUrl(url)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/x',
    'https://evil.example/x',
    'https://fcm.googleapis.com.evil.example/x',
    'https://user:pw@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://127.0.0.1/x',
    'https://localhost/x',
    'https://[::1]/x',
    'https://fcm.googleapis.com\\@evil.example/x',
    'https://fcm.googleapis.com./x',
    'https://web.push.apple.com/x#frag',
    'https://web.push.apple.com/x y',
    'https://FCM.googleapis.com/x',
    'https://web.push.apple.com',
  ])('rejects %s', (url) => {
    expect(isAllowedPushUrl(url)).toBe(false);
  });

  it('rejects a bare suffix host and a host that merely ends with the suffix text', () => {
    expect(isAllowedPushUrl('https://push.apple.com/x')).toBe(false);
    expect(isAllowedPushUrl('https://evilpush.apple.com/x')).toBe(false);
    expect(isAllowedPushUrl('https://.push.apple.com/x')).toBe(false);
  });

  it('rejects more than 2048 characters and never throws on non-strings', () => {
    expect(isAllowedPushUrl(`${ENDPOINT}${'a'.repeat(2048)}`)).toBe(false);
    expect(isAllowedPushUrl(null)).toBe(false);
    expect(isAllowedPushUrl(undefined)).toBe(false);
    expect(isAllowedPushUrl(42)).toBe(false);
    expect(isAllowedPushUrl({})).toBe(false);
  });
});

describe('pushSubscriptionRequestSchema', () => {
  const valid = { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } };

  it('accepts a valid subscription and strips unknown keys', () => {
    const parsed = pushSubscriptionRequestSchema.parse({ ...valid, expirationTime: null });
    expect(parsed).toEqual(valid);
  });

  it('rejects an endpoint off the allowlist or longer than 2048', () => {
    expect(
      pushSubscriptionRequestSchema.safeParse({ ...valid, endpoint: 'https://evil.example/x' })
        .success,
    ).toBe(false);
    expect(
      pushSubscriptionRequestSchema.safeParse({
        ...valid,
        endpoint: `${ENDPOINT}${'a'.repeat(2049)}`,
      }).success,
    ).toBe(false);
  });

  it.each([
    ['64 bytes', 'A'.repeat(86)],
    ['66 bytes', 'A'.repeat(88)],
    ['bad alphabet', `+${'A'.repeat(85)}A`],
    ['padding char', `${'A'.repeat(86)}=`],
    ['non-canonical last char', `${'A'.repeat(86)}B`],
  ])('rejects p256dh of %s', (_n, p256dh) => {
    expect(
      pushSubscriptionRequestSchema.safeParse({ ...valid, keys: { p256dh, auth: AUTH } }).success,
    ).toBe(false);
  });

  it.each([
    ['15 bytes', 'A'.repeat(20)],
    ['17 bytes', 'A'.repeat(23)],
    ['non-canonical last char', `${'A'.repeat(21)}B`],
    ['bad alphabet', `${'A'.repeat(21)}/`],
  ])('rejects auth of %s', (_n, auth) => {
    expect(
      pushSubscriptionRequestSchema.safeParse({ ...valid, keys: { p256dh: P256DH, auth } }).success,
    ).toBe(false);
  });
});

describe('unsubscribeRequestSchema', () => {
  it('accepts any endpoint of 1..2048 characters, even off the allowlist', () => {
    expect(unsubscribeRequestSchema.safeParse({ endpoint: 'https://evil.example/x' }).success).toBe(
      true,
    );
  });
  it('rejects empty and oversized endpoints', () => {
    expect(unsubscribeRequestSchema.safeParse({ endpoint: '' }).success).toBe(false);
    expect(unsubscribeRequestSchema.safeParse({ endpoint: 'a'.repeat(2049) }).success).toBe(false);
  });
});

describe('pushConfigResponseSchema', () => {
  it('accepts available with a key and unavailable without one', () => {
    expect(pushConfigResponseSchema.safeParse({ available: true, publicKey: 'k' }).success).toBe(
      true,
    );
    expect(pushConfigResponseSchema.safeParse({ available: false, publicKey: null }).success).toBe(
      true,
    );
  });
  it('rejects available with a null key and unavailable with a key', () => {
    expect(pushConfigResponseSchema.safeParse({ available: true, publicKey: null }).success).toBe(
      false,
    );
    expect(pushConfigResponseSchema.safeParse({ available: false, publicKey: 'k' }).success).toBe(
      false,
    );
  });
});

describe('pushPayloadSchema', () => {
  const base = {
    noticeId: '3f2b8c1e-9d4a-4b6f-8a1c-2e5d7f9a0b3c',
    title: 'Pesly',
    body: 'Body',
    url: '/es/notices',
  };
  it('accepts a same-origin path', () => {
    expect(pushPayloadSchema.safeParse(base).success).toBe(true);
    expect(pushPayloadSchema.safeParse({ ...base, body: '' }).success).toBe(true);
  });
  it.each(['//evil.example', 'https://evil.example', 'javascript:alert(1)', '/a\\b'])(
    'rejects url %s',
    (url) => {
      expect(pushPayloadSchema.safeParse({ ...base, url }).success).toBe(false);
    },
  );
  it('rejects bad title, body and id', () => {
    expect(pushPayloadSchema.safeParse({ ...base, title: '' }).success).toBe(false);
    expect(pushPayloadSchema.safeParse({ ...base, title: 'a'.repeat(41) }).success).toBe(false);
    expect(pushPayloadSchema.safeParse({ ...base, body: 'a'.repeat(301) }).success).toBe(false);
    expect(pushPayloadSchema.safeParse({ ...base, noticeId: 'nope' }).success).toBe(false);
  });
});

describe('pushNoticesLink and constants', () => {
  it('builds the localized notices link', () => {
    expect(pushNoticesLink('en')).toBe('/en/notices');
    expect(pushNoticesLink('es')).toBe('/es/notices');
  });
  it('builds the localized group link, which the payload schema accepts', () => {
    const id = '0b9f4c52-6a39-4f0e-9d0a-2a3f4f8d9a11';
    expect(pushGroupLink('es', id)).toBe(`/es/groups/${id}`);
    expect(pushGroupLink('en', id)).toBe(`/en/groups/${id}`);
    expect(pushGroupLink('en', 'a/b')).toBe('/en/groups/a%2Fb');
    expect(
      pushPayloadSchema.safeParse({
        noticeId: id,
        title: 'Pesly',
        body: 'x',
        url: pushGroupLink('es', id),
      }).success,
    ).toBe(true);
  });
  it('exposes the contract constants', () => {
    expect(PUSH_MAX_SUBSCRIPTIONS).toBe(10);
    expect(PUSH_TTL_SECONDS).toBe(21600);
    expect(PUSH_PAYLOAD_MAX_BYTES).toBe(3000);
    expect(PUSH_MAX_ATTEMPTS).toBe(5);
  });
});
