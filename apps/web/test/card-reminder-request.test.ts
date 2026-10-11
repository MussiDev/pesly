import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildCardUpdate,
  parseReminderDays,
} from '../src/features/credit-cards/card-reminder-request';

const saved = { closingDay: 24, dueDay: 5, reminderDays: 3 };

type Catalog = { [key: string]: string | Catalog };

function readKey(locale: 'en' | 'es', dottedKey: string): string | undefined {
  const path = fileURLToPath(new URL(`../messages/${locale}.json`, import.meta.url));
  let current: string | Catalog | undefined = JSON.parse(readFileSync(path, 'utf8')) as Catalog;
  for (const part of dottedKey.split('.')) {
    if (current === undefined || typeof current === 'string') return undefined;
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

describe('parseReminderDays (AC-03)', () => {
  it.each([
    ['0', 0],
    ['3', 3],
    ['30', 30],
    [' 7 ', 7],
  ])('accepts %j as %i', (text, expected) => {
    expect(parseReminderDays(text)).toBe(expected);
  });

  it.each(['-1', '31', '2.5', 'abc', '', '  ', '1e1', '+3'])(
    'returns null for %j (invalid input)',
    (text) => {
      expect(parseReminderDays(text)).toBeNull();
    },
  );
});

describe('buildCardUpdate (FR-02, D5)', () => {
  it('sends only the reminder days when only they changed, never the days', () => {
    expect(buildCardUpdate(saved, { ...saved, reminderDays: 7 })).toEqual({ reminderDays: 7 });
  });

  it('sends only the changed days', () => {
    expect(buildCardUpdate(saved, { ...saved, closingDay: 20 })).toEqual({ closingDay: 20 });
    expect(buildCardUpdate(saved, { closingDay: 20, dueDay: 6, reminderDays: 0 })).toEqual({
      closingDay: 20,
      dueDay: 6,
      reminderDays: 0,
    });
  });

  it('returns null when nothing changed', () => {
    expect(buildCardUpdate(saved, { ...saved })).toBeNull();
  });
});

describe('card reminder catalog keys (AC-08)', () => {
  it.each(['en', 'es'] as const)('has the form, detail and error strings in %s', (locale) => {
    for (const key of [
      'creditCards.form.reminderDays',
      'creditCards.form.reminderDaysHint',
      'creditCards.detail.reminderDays',
      'creditCards.detail.reminderDaysHint',
      'creditCards.errors.reminderDaysInvalid',
    ]) {
      expect(readKey(locale, key)?.length, `${locale} ${key}`).toBeGreaterThan(0);
    }
  });

  it.each(['en', 'es'] as const)('mentions card statements in the notices copy in %s', (locale) => {
    const pattern = locale === 'en' ? /statement/i : /res[uú]menes/i;
    expect(readKey(locale, 'notices.description')).toMatch(pattern);
    expect(readKey(locale, 'notices.empty')).toMatch(pattern);
  });
});
