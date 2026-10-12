export type PushSupport = 'unsupported' | 'ios-needs-install' | 'blocked' | 'ready';

/** Plain values read from the browser, so the decision is testable without one. */
export interface PushEnvironment {
  userAgent: string;
  maxTouchPoints: number;
  /** Running from the Home Screen. */
  standalone: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: NotificationPermission;
}

/** iPhone, iPad, or an iPad that presents a desktop Mac user agent (it is the touch screen that gives it away). */
function isIosDevice(env: PushEnvironment): boolean {
  if (/iPhone|iPad|iPod/.test(env.userAgent)) return true;
  return /Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1;
}

export function getPushSupport(env: PushEnvironment): PushSupport {
  // iOS only exposes push to an installed app, so the missing APIs there mean "install", not "unsupported".
  if (isIosDevice(env) && !env.standalone) return 'ios-needs-install';
  if (!env.hasPushManager || !env.hasNotification) return 'unsupported';
  if (env.permission === 'denied') return 'blocked';
  return 'ready';
}

/** Reads the running browser; `null` outside one (server render). */
export function readPushEnvironment(): PushEnvironment | null {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return null;
  const hasNotification = 'Notification' in window;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: iosStandalone || window.matchMedia('(display-mode: standalone)').matches,
    hasPushManager: 'PushManager' in window,
    hasNotification,
    permission: hasNotification ? Notification.permission : 'default',
  };
}

export function detectPushSupport(): PushSupport {
  const env = readPushEnvironment();
  return env === null ? 'unsupported' : getPushSupport(env);
}
