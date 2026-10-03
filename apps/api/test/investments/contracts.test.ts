import { describe, expect, it } from 'vitest';
import {
  INSTRUMENT_TYPES,
  QUANTITY_MAX,
  TOTAL_COST_MAX,
  UNIT_PRICE_MAX,
  addHoldingRequestSchema,
  addHoldingResponseSchema,
  createPortfolioRequestSchema,
  holdingIdParamsSchema,
  holdingResponseSchema,
  portfolioIdParamsSchema,
  portfolioListResponseSchema,
  portfolioResponseSchema,
  setPriceRequestSchema,
  updateHoldingRequestSchema,
} from '@pesly/shared';

const validHolding = {
  ticker: 'GGAL',
  instrumentName: 'Grupo Financiero Galicia',
  instrumentType: 'stock',
  quantity: '1000000000',
  valuationCurrency: 'ARS',
};

const validHoldingResponse = {
  id: '3f0c1c1e-5b6e-4d3a-9d0e-2f7d9c1a8b11',
  portfolioId: '4f0c1c1e-5b6e-4d3a-9d0e-2f7d9c1a8b11',
  ticker: 'GGAL',
  instrumentName: 'Grupo Financiero Galicia',
  instrumentType: 'stock',
  quantity: '1000000000',
  valuationCurrency: 'ARS',
  totalCost: '15000000',
  unitPrice: '1850000',
  priceSource: 'manual',
  pricedAt: '2026-10-01T12:00:00.000Z',
  value: '18500000',
  gain: { amount: '3500000', basisPoints: '2333' },
  priceStale: false,
  marketUnitPrice: null,
  marketPricedAt: null,
  marketPriceDiffers: false,
  marketPriceRecent: false,
};

describe('add holding contract', () => {
  it('accepts exactly the seven instrument types (AC-04)', () => {
    expect([...INSTRUMENT_TYPES]).toEqual([
      'stock',
      'cedear',
      'bond',
      'mutual_fund',
      'fixed_term_deposit',
      'crypto',
      'other',
    ]);
    for (const type of INSTRUMENT_TYPES) {
      const valuationCurrency = type === 'crypto' ? 'USD' : 'ARS';
      expect(
        addHoldingRequestSchema.safeParse({
          ...validHolding,
          instrumentType: type,
          valuationCurrency,
        }).success,
      ).toBe(true);
    }
    expect(
      addHoldingRequestSchema.safeParse({ ...validHolding, instrumentType: 'option' }).success,
    ).toBe(false);
  });

  it.each(['0', '-5', 'abc', '1.5', '', '1000000000000000001'])(
    'rejects quantity %j (AC-03)',
    (quantity) => {
      expect(addHoldingRequestSchema.safeParse({ ...validHolding, quantity }).success).toBe(false);
    },
  );

  it('rejects crypto with ARS on the valuationCurrency path (AC-18)', () => {
    const result = addHoldingRequestSchema.safeParse({
      ...validHolding,
      instrumentType: 'crypto',
      valuationCurrency: 'ARS',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join('.'))).toContain('valuationCurrency');
    }
  });

  it('trims text, bounds the total cost and rejects bad tickers', () => {
    const ok = addHoldingRequestSchema.safeParse({
      ...validHolding,
      ticker: ' GGAL ',
      totalCost: '1',
    });
    expect(ok.success && ok.data.ticker).toBe('GGAL');
    expect(addHoldingRequestSchema.safeParse({ ...validHolding, totalCost: '0' }).success).toBe(
      false,
    );
    expect(
      addHoldingRequestSchema.safeParse({ ...validHolding, totalCost: '1000000000000001' }).success,
    ).toBe(false);
    expect(addHoldingRequestSchema.safeParse({ ...validHolding, ticker: '-X' }).success).toBe(
      false,
    );
    expect(
      addHoldingRequestSchema.safeParse({ ...validHolding, ticker: 'A'.repeat(21) }).success,
    ).toBe(false);
  });
});

describe('exact maxima', () => {
  it('accepts quantity 10^18, total cost 10^15, unit price 10^12 and rejects one above', () => {
    expect(QUANTITY_MAX.toString()).toBe('1000000000000000000');
    expect(TOTAL_COST_MAX.toString()).toBe('1000000000000000');
    expect(UNIT_PRICE_MAX.toString()).toBe('1000000000000');
    const atMax = {
      ...validHolding,
      quantity: QUANTITY_MAX.toString(),
      totalCost: TOTAL_COST_MAX.toString(),
    };
    expect(addHoldingRequestSchema.safeParse(atMax).success).toBe(true);
    expect(
      addHoldingRequestSchema.safeParse({ ...atMax, quantity: (QUANTITY_MAX + 1n).toString() })
        .success,
    ).toBe(false);
    expect(
      addHoldingRequestSchema.safeParse({ ...atMax, totalCost: (TOTAL_COST_MAX + 1n).toString() })
        .success,
    ).toBe(false);
    expect(setPriceRequestSchema.safeParse({ unitPrice: UNIT_PRICE_MAX.toString() }).success).toBe(
      true,
    );
    expect(
      setPriceRequestSchema.safeParse({ unitPrice: (UNIT_PRICE_MAX + 1n).toString() }).success,
    ).toBe(false);
    expect(
      updateHoldingRequestSchema.safeParse({
        quantity: QUANTITY_MAX.toString(),
        totalCost: TOTAL_COST_MAX.toString(),
      }).success,
    ).toBe(true);
  });
});

describe('other request contracts', () => {
  it('rejects a unit price of 0 (AC-08)', () => {
    expect(setPriceRequestSchema.safeParse({ unitPrice: '0' }).success).toBe(false);
    expect(setPriceRequestSchema.safeParse({ unitPrice: '1850000' }).success).toBe(true);
    expect(setPriceRequestSchema.safeParse({ unitPrice: '1000000000001' }).success).toBe(false);
  });

  it('validates portfolio names and ids', () => {
    expect(createPortfolioRequestSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(createPortfolioRequestSchema.safeParse({ name: 'x'.repeat(61) }).success).toBe(false);
    expect(createPortfolioRequestSchema.safeParse({ name: ' IOL ' }).data?.name).toBe('IOL');
    expect(portfolioIdParamsSchema.safeParse({ portfolioId: 'nope' }).success).toBe(false);
    expect(holdingIdParamsSchema.safeParse({ holdingId: validHoldingResponse.id }).success).toBe(
      true,
    );
    expect(holdingIdParamsSchema.safeParse({ holdingId: 'nope' }).success).toBe(false);
    expect(holdingIdParamsSchema.safeParse({}).success).toBe(false);
    expect(Object.keys(holdingIdParamsSchema.shape)).toEqual(['holdingId']);
  });

  it('rejects an update changing the currency without the totalCost key', () => {
    expect(updateHoldingRequestSchema.safeParse({ valuationCurrency: 'USD' }).success).toBe(false);
    expect(
      updateHoldingRequestSchema.safeParse({ valuationCurrency: 'USD', totalCost: null }).success,
    ).toBe(true);
    expect(
      updateHoldingRequestSchema.safeParse({ valuationCurrency: 'USD', totalCost: '500' }).success,
    ).toBe(true);
  });

  it('rejects an update with no field and accepts partial updates', () => {
    expect(updateHoldingRequestSchema.safeParse({}).success).toBe(false);
    expect(updateHoldingRequestSchema.safeParse({ quantity: '5' }).success).toBe(true);
    expect(updateHoldingRequestSchema.safeParse({ totalCost: null }).success).toBe(true);
    expect(updateHoldingRequestSchema.safeParse({ totalCost: '0' }).success).toBe(false);
  });
});

describe('response contracts', () => {
  it('accepts a holding with string integers and nullable derived fields', () => {
    expect(holdingResponseSchema.safeParse(validHoldingResponse).success).toBe(true);
    expect(
      holdingResponseSchema.safeParse({
        ...validHoldingResponse,
        totalCost: null,
        unitPrice: null,
        priceSource: null,
        pricedAt: null,
        value: null,
        gain: null,
      }).success,
    ).toBe(true);
  });

  it('accepts a null gain and a negative gain amount with the final shape', () => {
    const nullGain = holdingResponseSchema.safeParse({ ...validHoldingResponse, gain: null });
    expect(nullGain.success && nullGain.data.gain).toBeNull();
    const loss = holdingResponseSchema.safeParse({
      ...validHoldingResponse,
      gain: { amount: '-3500000', basisPoints: '-2333' },
    });
    expect(loss.success && loss.data.gain?.amount).toBe('-3500000');
    expect(
      holdingResponseSchema.safeParse({
        ...validHoldingResponse,
        gain: { amount: '1.5', basisPoints: '3' },
      }).success,
    ).toBe(false);
  });

  it('requires priceStale and gain (the old field names are not the contract)', () => {
    const { priceStale, gain, ...rest } = validHoldingResponse;
    expect(priceStale).toBe(false);
    expect(gain).not.toBeNull();
    expect(holdingResponseSchema.safeParse({ ...rest, gain, stale: priceStale }).success).toBe(
      false,
    );
    expect(holdingResponseSchema.safeParse({ ...rest, priceStale }).success).toBe(false);
  });

  it.each([
    'marketUnitPrice',
    'marketPricedAt',
    'marketPriceDiffers',
    'marketPriceRecent',
  ] as const)('requires %s in the holding response', (field) => {
    const { [field]: removed, ...rest } = validHoldingResponse;
    expect(removed).toBeDefined();
    expect(holdingResponseSchema.safeParse(rest).success).toBe(false);
  });

  it('accepts a market price with its date and null market values', () => {
    const market = {
      ...validHoldingResponse,
      marketUnitPrice: '6400000',
      marketPricedAt: '2026-10-02T09:00:00.000Z',
      marketPriceDiffers: true,
      marketPriceRecent: true,
    };
    expect(holdingResponseSchema.safeParse(market).success).toBe(true);
    expect(holdingResponseSchema.safeParse(validHoldingResponse).success).toBe(true);
  });

  it.each(['1.5', '-1', '01', '', 'abc', 6400000.5])(
    'rejects an invalid marketUnitPrice %j',
    (marketUnitPrice) => {
      expect(
        holdingResponseSchema.safeParse({ ...validHoldingResponse, marketUnitPrice }).success,
      ).toBe(false);
    },
  );

  it('rejects a marketPricedAt that is not an ISO date-time and non-boolean flags', () => {
    expect(
      holdingResponseSchema.safeParse({ ...validHoldingResponse, marketPricedAt: 'today' }).success,
    ).toBe(false);
    expect(
      holdingResponseSchema.safeParse({ ...validHoldingResponse, marketPriceDiffers: 'yes' })
        .success,
    ).toBe(false);
    expect(
      holdingResponseSchema.safeParse({ ...validHoldingResponse, marketPriceRecent: null }).success,
    ).toBe(false);
  });

  it('rejects a response with a float amount', () => {
    expect(
      holdingResponseSchema.safeParse({ ...validHoldingResponse, value: 185000.5 }).success,
    ).toBe(false);
    expect(
      holdingResponseSchema.safeParse({ ...validHoldingResponse, value: '1850.50' }).success,
    ).toBe(false);
    expect(holdingResponseSchema.safeParse({ ...validHoldingResponse, value: '01' }).success).toBe(
      false,
    );
  });

  it('composes portfolio, list and add-holding responses', () => {
    const portfolio = {
      id: validHoldingResponse.portfolioId,
      name: 'IOL',
      createdAt: '2026-10-01T12:00:00.000Z',
      totals: [{ currency: 'ARS', value: '18500000' }],
      holdingsWithoutPrice: 0,
      holdings: [validHoldingResponse],
    };
    expect(portfolioResponseSchema.safeParse(portfolio).success).toBe(true);
    expect(
      portfolioResponseSchema.safeParse({ ...portfolio, createdAt: 'yesterday' }).success,
    ).toBe(false);
    const { createdAt, holdingsWithoutPrice, ...rest } = portfolio;
    expect(createdAt).toBeTypeOf('string');
    expect(portfolioResponseSchema.safeParse({ ...rest, holdingsWithoutPrice }).success).toBe(
      false,
    );
    expect(portfolioResponseSchema.safeParse({ ...rest, createdAt }).success).toBe(false);
    expect(
      portfolioResponseSchema.safeParse({ ...rest, createdAt, withoutPriceCount: 0 }).success,
    ).toBe(false);
    expect(portfolioListResponseSchema.safeParse({ portfolios: [portfolio] }).success).toBe(true);
    expect(
      addHoldingResponseSchema.safeParse({ holding: validHoldingResponse, merged: true }).success,
    ).toBe(true);
    expect(addHoldingResponseSchema.safeParse({ holding: validHoldingResponse }).success).toBe(
      false,
    );
  });
});
