import { describe, expect, it } from 'vitest';
import { getPushSupport, type PushEnvironment } from '../src/lib/push/push-support';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const MACINTOSH =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

function env(overrides: Partial<PushEnvironment> = {}): PushEnvironment {
  return {
    userAgent: ANDROID,
    maxTouchPoints: 5,
    standalone: false,
    hasPushManager: true,
    hasNotification: true,
    permission: 'default',
    ...overrides,
  };
}

describe('getPushSupport', () => {
  it('needs the Home Screen on an iPhone and on an iPadOS desktop user agent (AC-56)', () => {
    expect(getPushSupport(env({ userAgent: IPHONE, hasPushManager: false }))).toBe(
      'ios-needs-install',
    );
    expect(getPushSupport(env({ userAgent: MACINTOSH, maxTouchPoints: 5 }))).toBe(
      'ios-needs-install',
    );
  });

  it('is ready on the same agents in standalone mode (AC-56)', () => {
    expect(getPushSupport(env({ userAgent: IPHONE, standalone: true }))).toBe('ready');
    expect(getPushSupport(env({ userAgent: MACINTOSH, standalone: true }))).toBe('ready');
  });

  it('does not take a desktop Mac without touch for an iPad', () => {
    expect(getPushSupport(env({ userAgent: MACINTOSH, maxTouchPoints: 0 }))).toBe('ready');
  });

  it('is unsupported without PushManager or Notification on a non-iOS agent (AC-55)', () => {
    expect(getPushSupport(env({ hasPushManager: false }))).toBe('unsupported');
    expect(getPushSupport(env({ hasNotification: false }))).toBe('unsupported');
  });

  it('is blocked when the permission is denied (AC-55)', () => {
    expect(getPushSupport(env({ permission: 'denied' }))).toBe('blocked');
  });

  it('is ready when granted or still undecided', () => {
    expect(getPushSupport(env({ permission: 'granted' }))).toBe('ready');
    expect(getPushSupport(env())).toBe('ready');
  });
});
