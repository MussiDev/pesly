import { describe, expect, it } from 'vitest';
import {
  canonicalTimeZone,
  databaseTimeZone,
  ianaTimeZoneSchema,
  isIanaTimeZone,
} from '../src/profile/time-zone';

describe('time zone check', () => {
  it('accepts Europe/Madrid in any case and canonicalizes it (AC-07)', () => {
    expect(isIanaTimeZone('Europe/Madrid')).toBe(true);
    expect(isIanaTimeZone('europe/madrid')).toBe(true);
    expect(canonicalTimeZone('europe/madrid')).toBe('Europe/Madrid');
    expect(ianaTimeZoneSchema.parse('Europe/Madrid')).toBe('Europe/Madrid');
    expect(ianaTimeZoneSchema.parse('europe/madrid')).toBe('Europe/Madrid');
  });

  it('rejects unknown zones, numeric offsets, empty and oversized values (AC-08)', () => {
    for (const value of ['Mars/Olympus', '+01:00', '', 'a'.repeat(65)]) {
      expect(isIanaTimeZone(value), value).toBe(false);
      expect(ianaTimeZoneSchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe('database time zone', () => {
  it('maps legacy aliases to the zone Postgres knows and leaves canonical zones alone', () => {
    expect(databaseTimeZone('America/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
    expect(canonicalTimeZone('America/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
    expect(databaseTimeZone('Europe/Madrid')).toBe('Europe/Madrid');
  });
});
