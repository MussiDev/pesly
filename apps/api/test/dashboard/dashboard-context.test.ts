import { describe, expect, it } from 'vitest';
import { prepareDashboard } from '../../src/dashboard/application/dashboard-context';
import { readScope } from '../movements/db-fixtures';
import { FakePreferences, FixedClock } from './fakes';

const USER = '11111111-1111-4111-8111-111111111111';

async function run(timeZone = 'America/Argentina/Buenos_Aires') {
  const preferences = new FakePreferences({
    displayCurrency: 'USD',
    defaultRateType: 'blue',
    timeZone,
  });
  const context = await prepareDashboard(
    { clock: new FixedClock(), preferences },
    await readScope(USER),
  );
  return { context, preferences };
}

describe('prepareDashboard', () => {
  it('reads the preferences once and returns today, month and the user id', async () => {
    const { context, preferences } = await run();

    expect(preferences.calls).toBe(1);
    expect(context).toEqual({
      preferences: {
        displayCurrency: 'USD',
        defaultRateType: 'blue',
        timeZone: 'America/Argentina/Buenos_Aires',
      },
      today: '2026-10-06',
      month: '2026-10',
      monthStart: '2026-10-01',
      userId: USER,
    });
  });

  it('computes today in the stored zone', async () => {
    // 16:00 UTC on 6 October is already 7 October in Auckland.
    expect((await run('Pacific/Auckland')).context.today).toBe('2026-10-07');
  });

  it('crosses the month boundary in the zone of the user', async () => {
    const preferences = new FakePreferences({
      displayCurrency: 'ARS',
      defaultRateType: 'mep',
      timeZone: 'Pacific/Auckland',
    });
    const clock = new FixedClock(new Date('2026-10-31T12:00:00.000Z'));
    const context = await prepareDashboard({ clock, preferences }, await readScope(USER));

    expect(context.today).toBe('2026-11-01');
    expect(context.month).toBe('2026-11');
    expect(context.monthStart).toBe('2026-11-01');
  });

  it('propagates a missing user from the preferences reader', async () => {
    const preferences = {
      preferencesOf: () => Promise.reject(new Error('no such user')),
    };

    await expect(
      prepareDashboard({ clock: new FixedClock(), preferences }, await readScope(USER)),
    ).rejects.toThrow('no such user');
  });
});
