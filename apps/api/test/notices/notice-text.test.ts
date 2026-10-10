import { describe, expect, it } from 'vitest';
import { renderNoticeText } from '../../src/notices/domain/notice-text';

const DUE = '2026-10-05';

describe('renderNoticeText: reminder', () => {
  it('says "Luz vence mañana" in Spanish for one day (AC-15)', () => {
    expect(
      renderNoticeText({
        kind: 'reminder',
        language: 'es',
        paymentName: 'Luz',
        daysUntilDue: 1,
        dueDate: DUE,
      }),
    ).toBe('Luz vence mañana');
  });

  it('says "Electricity is due tomorrow" in English for one day (AC-16)', () => {
    expect(
      renderNoticeText({
        kind: 'reminder',
        language: 'en',
        paymentName: 'Electricity',
        daysUntilDue: 1,
        dueDate: DUE,
      }),
    ).toBe('Electricity is due tomorrow');
  });

  it.each([
    ['es', 0, 'Luz vence hoy'],
    ['es', 3, 'Luz vence en 3 días'],
    ['en', 0, 'Luz is due today'],
    ['en', 3, 'Luz is due in 3 days'],
  ] as const)('renders %s with %i days (AC-12)', (language, daysUntilDue, expected) => {
    expect(
      renderNoticeText({
        kind: 'reminder',
        language,
        paymentName: 'Luz',
        daysUntilDue,
        dueDate: DUE,
      }),
    ).toBe(expected);
  });
});

describe('renderNoticeText: invalid input', () => {
  it('rejects a reminder without days instead of guessing', () => {
    expect(() =>
      renderNoticeText({ kind: 'reminder', language: 'es', paymentName: 'Luz', dueDate: DUE }),
    ).toThrow('daysUntilDue');
  });
});

describe('renderNoticeText: recorded and not recorded', () => {
  it('renders recorded in both languages with the due day in UTC (AC-13)', () => {
    const es = renderNoticeText({
      kind: 'recorded',
      language: 'es',
      paymentName: 'Luz',
      dueDate: DUE,
    });
    const en = renderNoticeText({
      kind: 'recorded',
      language: 'en',
      paymentName: 'Luz',
      dueDate: DUE,
    });
    expect(es).toBe(
      `Se registró Luz del ${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date('2026-10-05T00:00:00Z'))}`,
    );
    expect(es).toMatch(/^Se registró Luz del 5 /);
    expect(en).toMatch(/^Luz of Oct 5 was recorded$/);
  });

  it('renders not_recorded in both languages (AC-13)', () => {
    const es = renderNoticeText({
      kind: 'not_recorded',
      language: 'es',
      paymentName: 'Luz',
      dueDate: DUE,
    });
    const en = renderNoticeText({
      kind: 'not_recorded',
      language: 'en',
      paymentName: 'Luz',
      dueDate: DUE,
    });
    expect(es).toMatch(/^No se pudo registrar Luz del 5 .*\. Está pendiente de tu confirmación\.$/);
    expect(en).toBe('Luz of Oct 5 could not be recorded. It is waiting for your confirmation.');
  });

  it('formats the day in UTC so a date never shifts', () => {
    expect(
      renderNoticeText({
        kind: 'recorded',
        language: 'en',
        paymentName: 'X',
        dueDate: '2026-01-01',
      }),
    ).toBe('X of Jan 1 was recorded');
  });
});

describe('renderNoticeText: privacy and limits', () => {
  it('never contains an amount or an account name, in both languages and all kinds (AC-17, NFR-05)', () => {
    // The function has no amount or account input; the payment is 350000.00 on account "Galicia".
    const texts = (['es', 'en'] as const).flatMap((language) => [
      renderNoticeText({
        kind: 'reminder',
        language,
        paymentName: 'Rent',
        daysUntilDue: 2,
        dueDate: DUE,
      }),
      renderNoticeText({ kind: 'recorded', language, paymentName: 'Rent', dueDate: DUE }),
      renderNoticeText({ kind: 'not_recorded', language, paymentName: 'Rent', dueDate: DUE }),
    ]);
    expect(texts).toHaveLength(6);
    for (const text of texts) {
      expect(text).not.toContain('350000');
      expect(text).not.toContain('Galicia');
    }
  });

  it('cuts the name to 80 characters and keeps the text under 300', () => {
    const text = renderNoticeText({
      kind: 'not_recorded',
      language: 'es',
      paymentName: 'N'.repeat(200),
      dueDate: DUE,
    });
    expect(text).toContain('N'.repeat(80));
    expect(text).not.toContain('N'.repeat(81));
    expect(text.length).toBeLessThan(300);
  });
});
