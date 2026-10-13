import {
  databaseTimeZone,
  DISPLAY_CURRENCY_VALUES,
  LANGUAGE_VALUES,
  type RateType,
} from '@pesly/shared';

export const DISPLAY_CURRENCIES = DISPLAY_CURRENCY_VALUES;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

export const LANGUAGES = LANGUAGE_VALUES;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_RATE_TYPE: RateType = 'mep';
export const DEFAULT_DISPLAY_CURRENCY: DisplayCurrency = 'ARS';
export const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';
export const DEFAULT_LANGUAGE: Language = 'es';

export const TIME_ZONE_MAX_LENGTH = 64;
export const LANGUAGE_MAX_LENGTH = 35;

/**
 * Keeps the device's time zone when the runtime's IANA database knows it, with a legacy alias such
 * as `America/Cordoba` stored as its canonical zone, and falls back to Buenos Aires otherwise (FR-10).
 */
export function resolveTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone || timeZone.length > TIME_ZONE_MAX_LENGTH) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return databaseTimeZone(timeZone);
  } catch {
    // RangeError: not a time zone the IANA database knows.
    return DEFAULT_TIME_ZONE;
  }
}

/** `en` and `en-*` (any case) become English; anything else, or nothing, becomes Spanish (FR-11). */
export function resolveLanguage(language: string | null | undefined): Language {
  if (!language || language.length > LANGUAGE_MAX_LENGTH) return DEFAULT_LANGUAGE;
  const normalized = language.toLowerCase();
  return normalized === 'en' || normalized.startsWith('en-') ? 'en' : DEFAULT_LANGUAGE;
}

export interface AccountDefaults {
  defaultRateType: RateType;
  displayCurrency: DisplayCurrency;
  timeZone: string;
  language: Language;
}

/** Settings of a new account from what the device reported (FR-09, FR-10, FR-11). */
export function newAccountDefaults(device: {
  timeZone?: string | null;
  language?: string | null;
}): AccountDefaults {
  return {
    defaultRateType: DEFAULT_RATE_TYPE,
    displayCurrency: DEFAULT_DISPLAY_CURRENCY,
    timeZone: resolveTimeZone(device.timeZone),
    language: resolveLanguage(device.language),
  };
}
