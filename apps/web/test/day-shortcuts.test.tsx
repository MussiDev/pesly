// @vitest-environment happy-dom
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DayShortcuts, previousDay } from '../src/features/movements/components/day-shortcuts';
import { CATALOGS, renderApp } from './support/render-app';

const t = CATALOGS.es.movements.form.dayShortcuts;

afterEach(cleanup);

describe('previousDay', () => {
  it('steps back across a month and a year boundary', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
  });
});

describe('DayShortcuts', () => {
  it('marks today and picks yesterday keeping the time of the field', async () => {
    const onPick = vi.fn();
    renderApp(<DayShortcuts today="2026-10-31T16:58" value="2026-10-31T09:15" onPick={onPick} />);

    expect(screen.getByRole('button', { name: t.today }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: t.yesterday }));
    expect(onPick).toHaveBeenCalledWith('2026-10-30T09:15');
  });

  it('error: an empty field falls back to the current time of day', async () => {
    const onPick = vi.fn();
    renderApp(<DayShortcuts today="2026-10-31T16:58" value="" onPick={onPick} />);

    expect(screen.getByRole('button', { name: t.today }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    await userEvent.click(screen.getByRole('button', { name: t.today }));
    expect(onPick).toHaveBeenCalledWith('2026-10-31T16:58');
  });
});
