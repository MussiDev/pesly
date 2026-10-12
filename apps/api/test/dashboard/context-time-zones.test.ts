import { describe, expect, it } from 'vitest';
import { ContextTimeZones } from '../../src/dashboard/application/context-time-zones';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('ContextTimeZones', () => {
  it('answers the zone already read for its own user', async () => {
    const zones = new ContextTimeZones(USER, 'America/Argentina/Buenos_Aires');

    await expect(zones.timeZoneOf(USER)).resolves.toBe('America/Argentina/Buenos_Aires');
  });

  it('fails closed for another user id', async () => {
    const zones = new ContextTimeZones(USER, 'America/Argentina/Buenos_Aires');

    await expect(zones.timeZoneOf(OTHER)).rejects.toThrow();
  });
});
