import { describe, expect, it } from 'vitest';
import { renderPushPayload } from '../../src/push/domain/push-payload';

const NOTICE_ID = '0b9f4c52-6a39-4f0e-9d0a-2a3f4f8d9a11';

const render = (
  overrides: Partial<Parameters<typeof renderPushPayload>[0]> = {},
): ReturnType<typeof renderPushPayload> =>
  renderPushPayload({
    noticeId: NOTICE_ID,
    kind: 'reminder',
    language: 'en',
    storedText: 'Electricity is due tomorrow',
    dueDate: '2026-10-15',
    ...overrides,
  });

describe('renderPushPayload', () => {
  it('uses the stored English text of a reminder (AC-32)', () => {
    expect(render().body).toBe('Electricity is due tomorrow');
  });

  it('uses the stored Spanish text of a reminder (AC-33)', () => {
    expect(render({ language: 'es', storedText: 'Luz vence mañana' }).body).toBe(
      'Luz vence mañana',
    );
  });

  it('gives a Spanish user the Spanish link and an English user the English one (AC-36, AC-37)', () => {
    expect(render({ language: 'es' })).toEqual({
      noticeId: NOTICE_ID,
      title: 'Pesly',
      body: 'Electricity is due tomorrow',
      url: '/es/notices',
    });
    expect(render({ language: 'en' }).url).toBe('/en/notices');
  });

  it('renders a statement notice from the day with no card name (AC-35)', () => {
    const stored = 'Statement of Visa Galicia is due on 2026-10-15';
    const en = render({ kind: 'card_statement_due', storedText: stored });
    const es = render({ kind: 'card_statement_due', language: 'es', storedText: stored });
    expect(en.body).toBe('A card statement is due on Oct 15');
    expect(es.body).toBe('Vence un resumen de tarjeta el 15 oct');
    expect(JSON.stringify([en, es])).not.toMatch(/Visa|Galicia/);
  });

  it('keeps amounts and account names out of every pushed kind and language (AC-34)', () => {
    for (const kind of ['reminder', 'recorded', 'not_recorded', 'card_statement_due'] as const) {
      for (const language of ['es', 'en'] as const) {
        const payload = render({ kind, language, storedText: 'Cuota pagada' });
        expect(JSON.stringify(payload)).not.toMatch(/350000|Galicia/);
      }
    }
  });

  it('links a group notice to its group and keeps its stored text', () => {
    const groupId = '5d1c3b8e-1f0a-4c55-8f61-0c2d3e4f5a6b';
    const expense = render({
      kind: 'group_expense',
      language: 'es',
      storedText: 'Bob agregó un gasto en Casa',
      groupId,
    });
    const settlement = render({ kind: 'group_settlement', language: 'en', groupId });

    expect(expense).toEqual({
      noticeId: NOTICE_ID,
      title: 'Pesly',
      body: 'Bob agregó un gasto en Casa',
      url: `/es/groups/${groupId}`,
    });
    expect(settlement.url).toBe(`/en/groups/${groupId}`);
  });

  it('links to the notices screen when the group id is null', () => {
    expect(render({ groupId: null }).url).toBe('/en/notices');
  });

  it('throws for a budget_alert kind (NFR-04)', () => {
    expect(() => render({ kind: 'budget_alert' })).toThrow();
  });

  it('throws when the payload passes 3,000 bytes and accepts exactly 3,000 (NFR-04)', () => {
    const overhead = new TextEncoder().encode(JSON.stringify(render({ storedText: '' }))).length;
    expect(() => render({ storedText: 'a'.repeat(3000 - overhead) })).not.toThrow();
    expect(() => render({ storedText: 'a'.repeat(3001 - overhead) })).toThrow();
  });
});
