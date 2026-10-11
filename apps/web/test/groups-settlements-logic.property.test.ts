import { describe, expect, it } from 'vitest';
import {
  RATE_MAX_SCALED,
  createSettlementRequestSchema,
  formatRateInput,
  type ConsolidationPreview,
} from '@pesly/shared';
import { buildConsolidationRequest } from '../src/features/groups/settlements/consolidation-request';
import {
  amountToInput,
  buildSettlementRequest,
} from '../src/features/groups/settlements/settlement-request';

const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-11T15:30:00.000Z');
const TZ = 'America/Argentina/Buenos_Aires';
const RUNS = 1000;

/** Deterministic xorshift so a failure reproduces; bigint end to end, no float on money. */
function makeRandom(seed: bigint) {
  let state = seed;
  return (maxExclusive: bigint): bigint => {
    state ^= (state << 13n) & 0xffffffffffffffffn;
    state ^= state >> 7n;
    state ^= (state << 17n) & 0xffffffffffffffffn;
    return state % maxExclusive;
  };
}

const group = (text: string, locale: string): string => {
  const separator = locale === 'es' ? '.' : ',';
  const [whole = '', fraction] = text.split(/[.,]/);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  return fraction === undefined
    ? grouped
    : `${grouped}${text.includes(',') ? ',' : '.'}${fraction}`;
};

describe('settlement requests (property)', () => {
  it('sends exactly the amount typed, and the shared validators accept every body', () => {
    const random = makeRandom(88172645463325252n);
    for (let run = 0; run < RUNS; run += 1) {
      const minor = random(10n ** 15n) + 1n;
      const locale = run % 2 === 0 ? 'es' : 'en';
      const typed =
        run % 4 < 2 ? amountToInput(minor, locale) : group(amountToInput(minor, locale), locale);
      const result = buildSettlementRequest(
        {
          fromMemberId: ANA,
          toMemberId: BRUNO,
          currency: run % 3 === 0 ? 'USD' : 'ARS',
          amount: typed,
          occurredAt: '2026-10-11T09:00',
          accountId: '',
        },
        {
          memberIds: [ANA, BRUNO],
          selfMemberId: ANA,
          accountIds: [],
          timeZone: TZ,
          locale,
          now: NOW,
        },
      );
      expect(result.fields, typed).toBeUndefined();
      expect(result.request?.amount, typed).toBe(minor.toString());
      expect(createSettlementRequestSchema.safeParse(result.request).success, typed).toBe(true);
    }
  });

  it('sends exactly the rate typed and the shared validators accept every body', () => {
    const random = makeRandom(2463534242n);
    const preview: ConsolidationPreview = {
      legs: { ARS: '500000', USD: '-1000' },
      defaultRateType: 'blue',
      rate: null,
    };
    for (let run = 0; run < RUNS; run += 1) {
      const scaled = random(RATE_MAX_SCALED) + 1n;
      const locale = run % 2 === 0 ? 'es' : 'en';
      const typed = formatRateInput(scaled, locale);
      const result = buildConsolidationRequest(
        preview,
        {
          memberA: ANA,
          memberB: BRUNO,
          currency: 'ARS',
          occurredAt: '2026-10-11T09:00',
          rate: typed,
        },
        { memberIds: [ANA, BRUNO], timeZone: TZ, locale, now: NOW },
      );
      // A cash above the movement maximum is refused by the builder, never sent.
      if (result.request === undefined) {
        expect(result.fields.rate, typed).toBe('groups.consolidate.errors.cashOutOfRange');
        continue;
      }
      expect(result.request.rate, typed).toBe(scaled.toString());
      expect(createSettlementRequestSchema.safeParse(result.request).success, typed).toBe(true);
    }
  });
});
