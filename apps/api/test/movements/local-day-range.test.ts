import { describe, expect, it } from 'vitest';
import { localDayRange } from '../../src/movements/application/local-day-range';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';
// Brazil started daylight-saving time at 00:00 on 2018-11-04, so that midnight never existed and
// the day began at 01:00 (UTC-2, 03:00Z).
const SAO_PAULO = 'America/Sao_Paulo';

describe('localDayRange', () => {
  it('returns the Buenos Aires (UTC-3) boundaries of the first and the day after the last day', () => {
    expect(localDayRange('2026-10-01', '2026-10-05', BUENOS_AIRES)).toEqual({
      occurredFrom: new Date('2026-10-01T03:00:00.000Z'),
      occurredBefore: new Date('2026-10-06T03:00:00.000Z'),
    });
  });

  it('a single local day spans exactly that day', () => {
    expect(localDayRange('2026-10-01', '2026-10-01', BUENOS_AIRES)).toEqual({
      occurredFrom: new Date('2026-10-01T03:00:00.000Z'),
      occurredBefore: new Date('2026-10-02T03:00:00.000Z'),
    });
  });

  it('returns only the bound that was asked for', () => {
    expect(localDayRange('2026-10-01', undefined, BUENOS_AIRES)).toEqual({
      occurredFrom: new Date('2026-10-01T03:00:00.000Z'),
    });
    expect(localDayRange(undefined, '2026-10-01', BUENOS_AIRES)).toEqual({
      occurredBefore: new Date('2026-10-02T03:00:00.000Z'),
    });
    expect(localDayRange(undefined, undefined, BUENOS_AIRES)).toEqual({});
  });

  it('rolls over month, year and leap-day ends with calendar arithmetic', () => {
    expect(localDayRange(undefined, '2026-12-31', BUENOS_AIRES).occurredBefore).toEqual(
      new Date('2027-01-01T03:00:00.000Z'),
    );
    expect(localDayRange(undefined, '2028-02-28', BUENOS_AIRES).occurredBefore).toEqual(
      new Date('2028-02-29T03:00:00.000Z'),
    );
    expect(localDayRange(undefined, '2028-02-29', BUENOS_AIRES).occurredBefore).toEqual(
      new Date('2028-03-01T03:00:00.000Z'),
    );
    expect(localDayRange(undefined, '2027-02-28', BUENOS_AIRES).occurredBefore).toEqual(
      new Date('2027-03-01T03:00:00.000Z'),
    );
  });

  it('starts a day whose midnight does not exist at the first valid hour', () => {
    const range = localDayRange('2018-11-04', '2018-11-03', SAO_PAULO);

    expect(range.occurredFrom).toEqual(new Date('2018-11-04T03:00:00.000Z'));
    // The day after the 3rd is the 4th, which begins at 01:00 local.
    expect(range.occurredBefore).toEqual(new Date('2018-11-04T03:00:00.000Z'));
  });

  it('a normal midnight after the skipped one is untouched', () => {
    expect(localDayRange(undefined, '2018-11-04', SAO_PAULO).occurredBefore).toEqual(
      new Date('2018-11-05T02:00:00.000Z'),
    );
  });
});
