// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PendingCardNote } from '../src/features/dashboard/components/pending-card-note';
import { CardPurchasesNote } from '../src/components/card-purchases-note';
import { formatShortDate } from '../src/features/credit-cards/format-dates';
import { formatMoney } from '../src/lib/format-amount';
import { CATALOGS, renderApp } from './support/render-app';

const { en, es } = CATALOGS;
const text = (value: string) => value.replace(/\s+/g, ' ');

describe('PendingCardNote (FEAT-015)', () => {
  it('shows the amount, the next due date and the rule in Spanish', () => {
    renderApp(
      <PendingCardNote
        locale="es"
        currency="ARS"
        pending={{ value: 15000000n, nextDueDate: '2026-11-05', leftOutCount: 0 }}
      />,
    );

    const note = screen.getByRole('note');
    expect(text(note.textContent)).toContain(text(formatMoney(15000000n, 'ARS', 'es')));
    expect(note.textContent).toContain(
      es.dashboard.month.pendingCard.due.replace('{date}', formatShortDate('2026-11-05', 'es')),
    );
    expect(note.textContent).toContain(es.dashboard.month.pendingCard.reason);
  });

  it('says how many pending installments have no rate, in English', () => {
    renderApp(
      <PendingCardNote
        locale="en"
        currency="USD"
        pending={{ value: 0n, nextDueDate: '2026-11-05', leftOutCount: 2 }}
      />,
      { locale: 'en' },
    );

    expect(screen.getByRole('note').textContent).toContain(
      '2 installments with no exchange rate are not added.',
    );
    expect(screen.getByText(en.dashboard.month.pendingCard.reason)).toBeDefined();
  });

  it('renders nothing when nothing is pending', () => {
    const { container } = renderApp(
      <PendingCardNote
        locale="es"
        currency="ARS"
        pending={{ value: 0n, nextDueDate: null, leftOutCount: 0 }}
      />,
    );

    expect(container.querySelector('[data-slot="pending-card-note"]')).toBeNull();
  });

  it('omits the due date line when there is none', () => {
    renderApp(
      <PendingCardNote
        locale="es"
        currency="ARS"
        pending={{ value: 10n, nextDueDate: null, leftOutCount: 0 }}
      />,
    );

    expect(screen.getByRole('note').textContent).not.toContain('Próximo vencimiento');
  });
});

describe('CardPurchasesNote rules', () => {
  it('keeps the due-month rule by default and states the paid rule on request', () => {
    renderApp(
      <>
        <CardPurchasesNote />
        <CardPurchasesNote rule="paid" />
      </>,
    );

    expect(screen.getByText(es.cardPurchasesNote.text)).toBeDefined();
    expect(screen.getByText(es.cardPurchasesNote.paidText)).toBeDefined();
  });
});
