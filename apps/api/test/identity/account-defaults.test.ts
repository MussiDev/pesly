import { DISPLAY_CURRENCY_VALUES, LANGUAGE_VALUES } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIME_ZONE,
  DISPLAY_CURRENCIES,
  LANGUAGES,
  newAccountDefaults,
  resolveLanguage,
  resolveTimeZone,
} from '../../src/identity/domain/account-defaults';

describe('account defaults', () => {
  it('new account defaults are rate type MEP and display currency ARS (AC-18)', () => {
    const defaults = newAccountDefaults({
      timeZone: 'America/Argentina/Buenos_Aires',
      language: 'es',
    });

    expect(defaults.defaultRateType).toBe('mep');
    expect(defaults.displayCurrency).toBe('ARS');
  });

  it('stores the legacy alias America/Cordoba as its canonical zone (AC-19)', () => {
    expect(resolveTimeZone('America/Cordoba')).toBe('America/Argentina/Cordoba');
    expect(newAccountDefaults({ timeZone: 'America/Cordoba' }).timeZone).toBe(
      'America/Argentina/Cordoba',
    );
  });

  it('keeps other valid IANA zones as reported', () => {
    expect(resolveTimeZone('Europe/Madrid')).toBe('Europe/Madrid');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['not an IANA zone', 'Mars/Olympus_Mons'],
    ['longer than 64 characters', `America/${'X'.repeat(60)}`],
  ])('resolves a %s time zone to America/Argentina/Buenos_Aires (AC-20)', (_label, timeZone) => {
    expect(DEFAULT_TIME_ZONE).toBe('America/Argentina/Buenos_Aires');
    expect(resolveTimeZone(timeZone)).toBe('America/Argentina/Buenos_Aires');
  });

  it.each(['en-US', 'en', 'en-GB', 'EN-us'])('maps language %s to en (AC-21)', (language) => {
    expect(resolveLanguage('es-AR')).toBe('es');
    expect(resolveLanguage(language)).toBe('en');
  });

  it.each([
    ['pt-BR', 'pt-BR'],
    ['missing', undefined],
    ['null', null],
    ['es-AR', 'es-AR'],
    ['english-like prefix', 'eng'],
    ['longer than 35 characters', `en-${'x'.repeat(40)}`],
  ])('maps language %s to es (AC-22)', (_label, language) => {
    expect(resolveLanguage(language)).toBe('es');
  });

  it('builds the full defaults from the device values', () => {
    expect(newAccountDefaults({ timeZone: 'Mars/Base', language: 'pt-BR' })).toEqual({
      defaultRateType: 'mep',
      displayCurrency: 'ARS',
      timeZone: 'America/Argentina/Buenos_Aires',
      language: 'es',
    });
  });
});

describe('account defaults share the profile lists', () => {
  it('uses the shared display currency and language lists (FR-05)', () => {
    expect(DISPLAY_CURRENCIES).toBe(DISPLAY_CURRENCY_VALUES);
    expect(LANGUAGES).toBe(LANGUAGE_VALUES);
    expect(newAccountDefaults({ timeZone: 'America/Cordoba', language: 'en-US' })).toEqual({
      defaultRateType: 'mep',
      displayCurrency: 'ARS',
      timeZone: 'America/Argentina/Cordoba',
      language: 'en',
    });
  });
});
