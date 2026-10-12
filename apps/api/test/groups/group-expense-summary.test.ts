import { beforeEach, describe, expect, it } from 'vitest';
import { CreateGroup, SummarizeGroupExpenses } from '../../src/groups';
import { ResourceNotFound } from '../../src/shared/access';
import { FakeClock, InMemoryGroupRepository } from './fakes';
import { FakeSummaryReader, summaryRow } from './summary-fakes';

const ALICE = '11111111-1111-4111-8111-111111111111';
const STRANGER = '99999999-9999-4999-8999-999999999999';
const RANGE = { from: '2026-10-01T03:00:00.000Z', to: '2026-10-31T02:59:59.999Z' };

let groups: InMemoryGroupRepository;
let reader: FakeSummaryReader;
let summarize: SummarizeGroupExpenses;
let groupId: string;
let categoryIds: string[];

beforeEach(async () => {
  groups = new InMemoryGroupRepository(new FakeClock());
  reader = new FakeSummaryReader();
  summarize = new SummarizeGroupExpenses({ groups, summaries: reader });
  const created = await new CreateGroup({ groups }).execute(ALICE, {
    name: 'Casa',
    defaultRateType: 'mep',
  });
  groupId = created.group.id;
  categoryIds = (await groups.listCategories(groupId)).map((category) => category.id);
});

describe('SummarizeGroupExpenses', () => {
  it('keeps each currency apart with its own lines and total (AC-26, AC-13)', async () => {
    const [a = '', b = '', c = ''] = categoryIds;
    reader.rows = [
      summaryRow('USD', a, 500n, 1),
      summaryRow('ARS', a, 1_000n, 2),
      summaryRow('ARS', b, 250n, 1),
      summaryRow('USD', c, 700n, 3),
    ];

    const result = await summarize.execute(ALICE, groupId, RANGE);

    expect(result.currencies.map((entry) => entry.currency)).toEqual(['ARS', 'USD']);
    const [ars, usd] = result.currencies;
    expect(ars).toEqual({
      currency: 'ARS',
      total: 1_250n,
      count: 3,
      categories: [
        { categoryId: a, total: 1_000n, count: 2 },
        { categoryId: b, total: 250n, count: 1 },
      ],
    });
    expect(usd?.total).toBe(1_200n);
    expect(usd?.categories.map((line) => line.categoryId)).toEqual([c, a]);
    expect(reader.calls).toEqual([
      { groupId, range: { from: new Date(RANGE.from), to: new Date(RANGE.to) } },
    ]);
  });

  it('orders by total descending and equal totals by category id ascending (AC-12)', async () => {
    reader.rows = [
      summaryRow('ARS', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 100n),
      summaryRow('ARS', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 100n),
      summaryRow('ARS', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 900n),
    ];

    const result = await summarize.execute(ALICE, groupId, RANGE);

    expect(result.currencies[0]?.categories.map((line) => line.categoryId)).toEqual([
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    ]);
  });

  it('sums beyond the safe integer range exactly, in bigint (NFR-03)', async () => {
    const [a = '', b = ''] = categoryIds;
    const big = 9_007_199_254_740_993n;
    reader.rows = [summaryRow('ARS', a, big), summaryRow('ARS', b, big)];

    const result = await summarize.execute(ALICE, groupId, RANGE);

    expect(result.currencies[0]?.total).toBe(big * 2n);
  });

  it('returns only the categories named by a line, archived ones included (AC-18)', async () => {
    const [a = '', b = ''] = categoryIds;
    const stored = groups.categories.get(groupId) ?? [];
    groups.categories.set(
      groupId,
      stored.map((category) =>
        category.id === b
          ? { ...category, archivedAt: new Date('2026-09-01T00:00:00.000Z') }
          : category,
      ),
    );
    reader.rows = [summaryRow('ARS', a, 10n), summaryRow('ARS', b, 20n)];

    const result = await summarize.execute(ALICE, groupId, RANGE);

    expect(result.categories.map((category) => category.id).sort()).toEqual([a, b].sort());
    expect(result.categories.find((category) => category.id === b)?.archivedAt).not.toBeNull();
    expect(categoryIds.length).toBeGreaterThan(2);
  });

  it('answers an empty currency list for a range without expenses (AC-16)', async () => {
    const result = await summarize.execute(ALICE, groupId, RANGE);

    expect(result.currencies).toEqual([]);
    expect(result.categories).toEqual([]);
  });

  it('answers not found to a non-member and to an unknown group without reading (AC-28)', async () => {
    await expect(summarize.execute(STRANGER, groupId, RANGE)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(
      summarize.execute(ALICE, '88888888-8888-4888-8888-888888888888', RANGE),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(reader.calls).toEqual([]);
  });
});
