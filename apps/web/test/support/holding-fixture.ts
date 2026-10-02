import type { HoldingResponse } from '@pesly/shared';

export const PRICED_AT = '2026-09-01T15:30:00.000Z';

export const HOLDING: HoldingResponse = {
  id: '11111111-1111-4111-8111-111111111111',
  portfolioId: '22222222-2222-4222-8222-222222222222',
  ticker: 'AAPL',
  instrumentName: 'Apple Inc.',
  instrumentType: 'cedear',
  quantity: '1000000000',
  valuationCurrency: 'ARS',
  totalCost: '15000000',
  unitPrice: '1850000',
  priceSource: 'manual',
  pricedAt: PRICED_AT,
  priceStale: false,
  marketUnitPrice: null,
  marketPricedAt: null,
  marketPriceDiffers: false,
  marketPriceRecent: false,
  value: '18500000',
  gain: { amount: '3500000', basisPoints: '2333' },
};
