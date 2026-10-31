import { describe, expect, it } from 'vitest';
import {
  deviceTimeZone,
  suggestedTimeZones,
  timeZoneOptions,
} from '../src/features/profile/time-zones';

describe('timeZoneOptions', () => {
  it('lists the runtime time zones, sorted and without repeats', () => {
    const options = timeZoneOptions('Europe/Madrid');
    expect(options).toContain('America/New_York');
    expect(options).toContain('Europe/Madrid');
    expect(new Set(options).size).toBe(options.length);
    expect(options).toEqual([...options].sort());
  });

  it('adds a saved value the runtime does not list, once', () => {
    const options = timeZoneOptions('+01:00');
    expect(options.filter((value) => value === '+01:00')).toHaveLength(1);
    expect(options).toContain('Europe/Madrid');
  });
});

describe('suggestedTimeZones', () => {
  it('offers the saved zone and the device zone first, once each', () => {
    expect(suggestedTimeZones('America/Argentina/Buenos_Aires', 'Europe/Madrid')).toEqual([
      'America/Argentina/Buenos_Aires',
      'Europe/Madrid',
    ]);
    expect(suggestedTimeZones('Europe/Madrid', 'Europe/Madrid')).toEqual(['Europe/Madrid']);
  });

  it('error: drops an empty saved value and a missing device zone', () => {
    expect(suggestedTimeZones('', undefined)).toEqual([]);
  });

  it('reads the device zone from the runtime', () => {
    expect(typeof deviceTimeZone()).toBe('string');
  });
});
