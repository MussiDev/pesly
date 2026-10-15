// @vitest-environment happy-dom
import type { InstallmentSchedule, ScheduleRow } from '@pesly/shared';
import { previewInstallmentSchedule } from '@pesly/shared';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import { InstallmentSchedulePreview } from '../src/features/credit-cards/components/installment-schedule-preview';
import { formatCalendarDate, formatPeriod } from '../src/features/credit-cards/format-dates';
import { formatMoney } from '../src/lib/format-amount';
import { renderApp } from './support/render-app';

const CATALOGS = { en, es } as const;

const row = (overrides: Partial<ScheduleRow> = {}): ScheduleRow => ({
  number: 1,
  amount: 1_000_000n,
  period: '2026-11',
  closingDate: '2026-11-20',
  dueDate: '2026-12-05',
  closed: false,
  ...overrides,
});

const schedule = (overrides: Partial<InstallmentSchedule> = {}): InstallmentSchedule => ({
  kind: 'installments',
  rows: [
    row(),
    row({
      number: 2,
      amount: 999_999n,
      period: '2026-12',
      closingDate: '2026-12-20',
      dueDate: '2027-01-05',
    }),
  ],
  firstClosed: false,
  firstClosingDate: '2026-11-20',
  ...overrides,
});

describe('InstallmentSchedulePreview', () => {
  it.each(['en', 'es'] as const)(
    'renders one row per payment with number, amount, statement, closing and due date in %s (AC-02)',
    (locale) => {
      const value = schedule();
      renderApp(<InstallmentSchedulePreview schedule={value} currency="ARS" />, { locale });

      const rows = within(screen.getByRole('table')).getAllByRole('row');
      expect(rows).toHaveLength(3);
      for (const [index, expected] of value.rows.entries()) {
        const cells = within(rows[index + 1] as HTMLElement)
          .getAllByRole('cell')
          .map((cell) => cell.textContent);
        expect(cells).toEqual([
          String(expected.number),
          formatMoney(expected.amount, 'ARS', locale),
          formatPeriod(expected.period, locale),
          formatCalendarDate(expected.closingDate, locale),
          formatCalendarDate(expected.dueDate, locale),
        ]);
      }
    },
  );

  it.each(['en', 'es'] as const)(
    'renders the closing-day note naming the first closing date in %s (AC-05)',
    (locale) => {
      renderApp(<InstallmentSchedulePreview schedule={schedule()} currency="ARS" />, { locale });

      const date = formatCalendarDate('2026-11-20', locale);
      const note = CATALOGS[locale].creditCards.installments.preview.closingDayNote.replace(
        '{date}',
        date,
      );
      expect(screen.getByText(note)).toBeTruthy();
      // The note must state the closing-day rule, not only the date.
      expect(note).toContain(locale === 'en' ? 'closing day' : 'día de cierre');
    },
  );

  it('renders the closed warning and the badge only when the first statement is closed (AC-06)', () => {
    const preview = en.creditCards.installments.preview;
    const { unmount } = renderApp(
      <InstallmentSchedulePreview schedule={schedule()} currency="ARS" />,
      { locale: 'en' },
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(preview.closedBadge)).toBeNull();
    unmount();

    const closed = schedule({
      firstClosed: true,
      rows: [row({ closed: true }), row({ number: 2, period: '2026-12' })],
    });
    renderApp(<InstallmentSchedulePreview schedule={closed} currency="ARS" />, { locale: 'en' });
    const warning = screen.getByRole('status');
    expect(within(warning).getByText(preview.closedWarning)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByText(preview.closedBadge)).toHaveLength(1);
  });

  it('shows the expense label for one row and the installments label for several (AC-07)', () => {
    const preview = en.creditCards.installments.preview;
    const single = schedule({ kind: 'expense', rows: [row()] });
    const { unmount } = renderApp(<InstallmentSchedulePreview schedule={single} currency="ARS" />, {
      locale: 'en',
    });
    expect(screen.getByRole('table', { name: preview.expenseLabel })).toBeTruthy();
    expect(screen.queryByText(preview.installmentsLabel)).toBeNull();
    unmount();

    renderApp(<InstallmentSchedulePreview schedule={schedule()} currency="ARS" />, {
      locale: 'en',
    });
    expect(screen.getByRole('table', { name: preview.installmentsLabel })).toBeTruthy();
    expect(screen.queryByText(preview.expenseLabel)).toBeNull();
  });

  it('shows USD amounts and no ARS figure for a USD schedule (AC-10)', () => {
    renderApp(<InstallmentSchedulePreview schedule={schedule()} currency="USD" />, {
      locale: 'en',
    });

    const table = screen.getByRole('table');
    expect(table.textContent).toContain(formatMoney(1_000_000n, 'USD', 'en'));
    expect(table.textContent).not.toContain('ARS');
  });

  it('renders nothing and shows no error for a null schedule (AC-01)', () => {
    const { container } = renderApp(<InstallmentSchedulePreview schedule={null} currency="ARS" />, {
      locale: 'en',
    });

    expect(container.textContent).toBe('');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('exposes column headers to the accessibility tree and renders 60 rows (AC-02)', () => {
    const sixty = previewInstallmentSchedule({
      total: 6_000_001n,
      count: 60,
      purchasedOn: '2026-10-10',
      today: '2026-10-15',
      card: { closingDay: 20, dueDay: 5 },
      statements: [],
    });
    renderApp(<InstallmentSchedulePreview schedule={sixty} currency="ARS" />, { locale: 'en' });

    const columns = en.creditCards.installments.preview.columns;
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual([
      columns.number,
      columns.amount,
      columns.statement,
      columns.closes,
      columns.due,
    ]);
    for (const header of headers) expect(header.getAttribute('scope')).toBe('col');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(61);
  });

  it('renders each value as a plain text cell (AC-02)', () => {
    renderApp(
      <InstallmentSchedulePreview
        schedule={schedule({ rows: [row({ period: '2026-11' })] })}
        currency="ARS"
      />,
      {
        locale: 'en',
      },
    );

    for (const cell of screen.getAllByRole('cell')) expect(cell.children).toHaveLength(0);
  });
});
