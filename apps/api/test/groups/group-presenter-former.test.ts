import { describe, expect, it } from 'vitest';
import { presentGroupDetail } from '../../src/groups/infrastructure/http/group-presenter';

describe('presentGroupDetail', () => {
  it('emits the former members with ISO dates and no user data', () => {
    const leftAt = new Date('2026-10-11T08:00:00.000Z');
    const body = presentGroupDetail({
      group: {
        id: 'g1',
        name: 'Casa',
        defaultRateType: 'mep',
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
      role: 'admin',
      memberCount: 0,
      members: [],
      formerMembers: [{ id: 'm1', displayName: 'Bea', leftAt }],
    });

    expect(body.formerMembers).toEqual([
      { id: 'm1', displayName: 'Bea', leftAt: '2026-10-11T08:00:00.000Z' },
    ]);
  });
});
