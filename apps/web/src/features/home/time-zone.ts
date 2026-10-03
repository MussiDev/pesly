const FALLBACK_TIME_ZONE = 'UTC';

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch (error) {
    // Only a RangeError means a bad zone; anything else is a real failure.
    if (!(error instanceof RangeError)) throw error;
    return false;
  }
}

/** The browser's zone, or UTC when it is unavailable or not a valid IANA zone. */
export function browserTimeZone(): string {
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimeZone(zone) ? zone : FALLBACK_TIME_ZONE;
}

/** A medium date in `timeZone`; an invalid zone shows the date in UTC instead of failing. */
export function formatDay(occurredAt: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: isValidTimeZone(timeZone) ? timeZone : FALLBACK_TIME_ZONE,
  }).format(new Date(occurredAt));
}
