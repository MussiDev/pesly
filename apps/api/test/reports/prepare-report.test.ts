import { describe, expect, it } from 'vitest';
import { prepareReport } from '../../src/reports/application/prepare-report';
import { ResourceNotFound } from '../../src/shared/access';
import { readScope } from '../movements/db-fixtures';
import { FakeFilterReader, FakePreferences, FixedClock } from './fakes';

const ACCOUNT = '3f0c1c9e-5c53-4a53-9a55-0d6a4c0f0a01';
const SPEC = { maxMonths: 12, defaultMonths: 12 } as const;

async function run(
  query: Parameters<typeof prepareReport>[2],
  options: { spec?: { maxMonths: number; defaultMonths: number }; timeZone?: string } = {},
) {
  const preferences = new FakePreferences({
    displayCurrency: 'USD',
    defaultRateType: 'blue',
    timeZone: options.timeZone ?? 'America/Argentina/Buenos_Aires',
  });
  const deps = {
    clock: new FixedClock(),
    preferences,
    filters: new FakeFilterReader([ACCOUNT], ['Vacations2026']),
  };
  const scope = await readScope('11111111-1111-4111-8111-111111111111');
  return prepareReport(deps, scope, query, options.spec ?? SPEC);
}

describe('prepareReport', () => {
  it('returns preferences, today, range, instant bounds and filters', async () => {
    const context = await run({ from: '2026-03-01', to: '2026-03-31', accountId: ACCOUNT });

    expect(context.preferences).toEqual({
      displayCurrency: 'USD',
      defaultRateType: 'blue',
      timeZone: 'America/Argentina/Buenos_Aires',
    });
    expect(context.today).toBe('2026-10-06');
    expect(context.range).toEqual({ from: '2026-03-01', to: '2026-03-31', months: 1 });
    expect(context.bounds.from.toISOString()).toBe('2026-03-01T03:00:00.000Z');
    expect(context.bounds.before.toISOString()).toBe('2026-04-01T03:00:00.000Z');
    expect(context.accountId).toBe(ACCOUNT);
    expect(context.tag).toBeUndefined();
  });

  it('defaults the range from the spec and accepts to equal to today', async () => {
    const context = await run({ to: '2026-10-06' }, { spec: { maxMonths: 24, defaultMonths: 1 } });

    expect(context.range.from).toBe('2026-10-01');
    expect(context.range.to).toBe('2026-10-06');
  });

  it('computes today in the zone of the user', async () => {
    // 16:00 UTC is already 2026-10-07 in Auckland.
    const context = await run({}, { timeZone: 'Pacific/Auckland' });

    expect(context.today).toBe('2026-10-07');
  });

  it('refuses a range over the limit with details.maxMonths, a to after today and from after to', async () => {
    await expect(run({ from: '2025-09-01', to: '2026-10-06' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { maxMonths: '12' },
    });
    await expect(run({ to: '2026-10-07' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: ['query.to'],
    });
    await expect(run({ from: '2026-05-02', to: '2026-05-01' })).rejects.toMatchObject({
      fields: ['query.from'],
    });
  });

  it('throws ResourceNotFound for an unknown account or tag, and accepts a tag in any case', async () => {
    await expect(run({ accountId: '3f0c1c9e-5c53-4a53-9a55-0d6a4c0f0aff' })).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(run({ tag: 'nope' })).rejects.toBeInstanceOf(ResourceNotFound);
    expect((await run({ tag: 'vacations2026' })).tag).toBe('vacations2026');
  });

  it('does not check filters when the range is already invalid', async () => {
    await expect(run({ to: '2027-01-01', tag: 'nope' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});
