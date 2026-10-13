import { z } from 'zod';

export const TIME_ZONE_MAX_LENGTH = 64;

// Excludes numeric offsets such as `+01:00`, which `Intl` accepts but the IANA database does not list.
const IANA_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

function formatterFor(value: string): Intl.DateTimeFormat | null {
  if (value.length === 0 || value.length > TIME_ZONE_MAX_LENGTH || !IANA_SHAPE.test(value)) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value });
  } catch {
    // RangeError: not a time zone the runtime's IANA database knows.
    return null;
  }
}

/**
 * Legacy names browsers still report and `Intl` accepts, but whose link the production Postgres
 * tzdata does not carry: `AT TIME ZONE 'America/Buenos_Aires'` fails there with `22023`.
 */
const LEGACY_ALIASES: Readonly<Record<string, string>> = {
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'America/Rosario': 'America/Argentina/Cordoba',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Europe/Kiev': 'Europe/Kyiv',
};

/** The spelling every database query must bind: a legacy alias becomes its canonical zone. */
export function databaseTimeZone(value: string): string {
  return LEGACY_ALIASES[value] ?? value;
}

export function isIanaTimeZone(value: string): boolean {
  return formatterFor(value) !== null;
}

/** The runtime's spelling of a valid zone (`europe/madrid` becomes `Europe/Madrid`). */
export function canonicalTimeZone(value: string): string {
  const formatter = formatterFor(value);
  if (!formatter) throw new RangeError(`Invalid IANA time zone: ${value}`);
  return databaseTimeZone(formatter.resolvedOptions().timeZone);
}

export const ianaTimeZoneSchema = z
  .string()
  .max(TIME_ZONE_MAX_LENGTH)
  .refine(isIanaTimeZone, { message: 'must be an IANA time zone' })
  .transform(canonicalTimeZone);
