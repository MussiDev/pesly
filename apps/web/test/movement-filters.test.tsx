// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import {
  MovementFilters,
  type MovementFiltersProps,
} from '../src/features/movements/components/movement-filters';
import {
  filtersToListParams,
  hasActiveFilters,
  isRangeInvalid,
  parseFilters,
  serializeFilters,
} from '../src/features/movements/movement-filters-state';
import { uuid } from './support/category-fixtures';

afterEach(cleanup);

const CAJA = uuid(1);
const COMIDA = uuid(11);
const ALMUERZO = uuid(12);

function renderBar(props: Partial<MovementFiltersProps> = {}, locale: 'es' | 'en' = 'es') {
  const onChange = vi.fn();
  const onClear = vi.fn();
  const view = render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={locale === 'es' ? es : en}>
      <MovementFilters
        filters={{}}
        accounts={[
          { id: CAJA, label: 'Caja' },
          { id: uuid(2), label: 'Dolares' },
        ]}
        categories={[
          { id: COMIDA, label: 'Comida', indent: false },
          { id: ALMUERZO, label: 'Almuerzo', indent: true },
        ]}
        rangeInvalid={false}
        onChange={onChange}
        onClear={onClear}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onChange, onClear, ...view };
}

const optionTexts = (select: HTMLElement) =>
  within(select)
    .getAllByRole('option')
    .map((option) => option.textContent);

describe('parseFilters', () => {
  const read = (query: string) => parseFilters(new URLSearchParams(query));

  it('reads every valid filter', () => {
    expect(
      read(
        `accountId=${CAJA}&categoryId=${COMIDA}&from=2026-10-01&to=2026-10-31&type=income&tag=Viaje`,
      ),
    ).toEqual({
      accountId: CAJA,
      categoryId: COMIDA,
      from: '2026-10-01',
      to: '2026-10-31',
      type: 'income',
      tag: 'Viaje',
    });
  });

  it('ignores malformed values one by one and keeps the valid ones (invalid input)', () => {
    expect(
      read(
        `accountId=nope&categoryId=${COMIDA}&from=2026-13-45&to=31-10-2026&type=refund&tag=%20%20`,
      ),
    ).toEqual({ categoryId: COMIDA });
    expect(read(`tag=${'a'.repeat(31)}`)).toEqual({});
    expect(read('from=&to=')).toEqual({});
  });

  it.each(['transfer', 'exchange'] as const)('reads and sends type=%s', (type) => {
    const filters = read(`type=${type}`);

    expect(filters).toEqual({ type });
    expect(serializeFilters(filters).toString()).toBe(`type=${type}`);
    expect(filtersToListParams(filters)).toEqual({ type });
  });

  it('returns no filters for an empty query', () => {
    expect(read('')).toEqual({});
  });
});

describe('serializeFilters', () => {
  it('writes only the present filters and round-trips with parseFilters', () => {
    const filters = { accountId: CAJA, from: '2026-10-01', type: 'expense' as const, tag: 'Viaje' };
    const query = serializeFilters(filters).toString();

    expect(query).toBe(`accountId=${CAJA}&from=2026-10-01&type=expense&tag=Viaje`);
    expect(parseFilters(new URLSearchParams(query))).toEqual(filters);
    expect(serializeFilters({}).toString()).toBe('');
  });
});

describe('filter helpers', () => {
  it('detects an active filter', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ tag: 'x' })).toBe(true);
  });

  it('flags a from after the to, and only that', () => {
    expect(isRangeInvalid({ from: '2026-10-10', to: '2026-10-01' })).toBe(true);
    expect(isRangeInvalid({ from: '2026-10-01', to: '2026-10-01' })).toBe(false);
    expect(isRangeInvalid({ from: '2026-10-10' })).toBe(false);
  });

  it('maps the filters to the list params as typed, without empty keys', () => {
    expect(filtersToListParams({ from: '2026-10-01', tag: 'Viaje' })).toEqual({
      from: '2026-10-01',
      tag: 'Viaje',
    });
  });
});

describe('MovementFilters', () => {
  it('offers all accounts, categories and types with a neutral first option', () => {
    renderBar();

    expect(optionTexts(screen.getByLabelText(es.movements.filters.account))).toEqual([
      es.movements.filters.allAccounts,
      'Caja',
      'Dolares',
    ]);
    expect(
      within(screen.getByRole('group', { name: es.movements.filters.type }))
        .getAllByRole('button')
        .map((chip) => chip.textContent),
    ).toEqual([
      es.movements.filters.all,
      es.movements.types.expense,
      es.movements.types.income,
      es.movements.types.transfer,
      es.movements.types.exchange,
    ]);
    expect(screen.getByLabelText(es.movements.filters.from)).toBeDefined();
    expect(screen.getByLabelText(es.movements.filters.to)).toBeDefined();
  });

  it('indents a subcategory under its parent', () => {
    renderBar();
    const options = within(screen.getByLabelText(es.movements.filters.category)).getAllByRole(
      'option',
    );

    expect(options[1]?.textContent).toBe('Comida');
    expect(options[2]?.textContent.trim()).toBe('Almuerzo');
    expect(options[2]?.textContent).not.toBe('Almuerzo');
  });

  it('reports the next filters when a select, a date or the clear button is used', async () => {
    const { onChange, onClear } = renderBar({ filters: { tag: 'Viaje' } });
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText(es.movements.filters.account), CAJA);
    expect(onChange).toHaveBeenLastCalledWith({ tag: 'Viaje', accountId: CAJA });
    await user.click(
      within(screen.getByRole('group', { name: es.movements.filters.type })).getByRole('button', {
        name: es.movements.types.income,
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ tag: 'Viaje', type: 'income' });
    await user.click(
      within(screen.getByRole('group', { name: es.movements.filters.type })).getByRole('button', {
        name: es.movements.types.transfer,
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ tag: 'Viaje', type: 'transfer' });
    await user.click(
      within(screen.getByRole('group', { name: es.movements.filters.type })).getByRole('button', {
        name: es.movements.types.exchange,
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ tag: 'Viaje', type: 'exchange' });
    fireEvent.change(screen.getByLabelText(es.movements.filters.from), {
      target: { value: '2026-10-01' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ tag: 'Viaje', from: '2026-10-01' });

    await user.click(screen.getByRole('button', { name: es.movements.filters.clear }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('keeps a partly typed date in the box and reports it only once it is a real day (invalid input)', () => {
    const { onChange } = renderBar();
    const from = screen.getByLabelText<HTMLInputElement>(es.movements.filters.from);

    // The browser reports these while the year is being typed.
    fireEvent.change(from, { target: { value: '0002-09-01' } });
    fireEvent.change(from, { target: { value: '0202-09-01' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(from.value).toBe('0202-09-01');

    fireEvent.change(from, { target: { value: '2026-09-01' } });
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-09-01' });
  });

  it('reports an emptied date so the filter can be removed', () => {
    const { onChange } = renderBar({ filters: { from: '2026-09-01' } });

    fireEvent.change(screen.getByLabelText(es.movements.filters.from), { target: { value: '' } });

    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('turning a select back to "all" removes that filter', async () => {
    const { onChange } = renderBar({ filters: { accountId: CAJA } });

    await userEvent.setup().selectOptions(screen.getByLabelText(es.movements.filters.account), '');

    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('hides the clear button while no filter is active', () => {
    renderBar();
    expect(screen.queryByRole('button', { name: es.movements.filters.clear })).toBeNull();
  });

  it('shows the invalid-range message and links it to the date inputs', () => {
    renderBar({ filters: { from: '2026-10-10', to: '2026-10-01' }, rangeInvalid: true });

    const message = screen.getByText(es.movements.filters.invalidRange);
    expect(message.getAttribute('role')).toBe('alert');
    const from = screen.getByLabelText<HTMLInputElement>(es.movements.filters.from);
    expect(from.getAttribute('aria-invalid')).toBe('true');
    expect(from.getAttribute('aria-describedby')).toBe(message.id);
  });

  it('renders the tag box the container injects, with the single chosen tag', () => {
    renderBar({
      filters: { tag: 'Viaje' },
      renderTagField: ({ value }) => <p>{`tag box: ${value.join(',')}`}</p>,
    });

    expect(screen.getByText('tag box: Viaje')).toBeDefined();
  });

  it('a tag chosen in the box replaces the previous one (one tag per filter)', () => {
    const { onChange } = renderBar({
      filters: { tag: 'Viaje' },
      renderTagField: ({ onChange: setTags }) => (
        <button
          type="button"
          onClick={() => {
            setTags(['Viaje', 'Auto']);
          }}
        >
          pick
        </button>
      ),
    });

    fireEvent.click(screen.getByText('pick'));

    expect(onChange).toHaveBeenLastCalledWith({ tag: 'Auto' });
  });

  it('removing the chip clears the tag filter', () => {
    const { onChange } = renderBar({
      filters: { tag: 'Viaje' },
      renderTagField: ({ onChange: setTags }) => (
        <button
          type="button"
          onClick={() => {
            setTags([]);
          }}
        >
          drop
        </button>
      ),
    });

    fireEvent.click(screen.getByText('drop'));

    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('hands the container a ref to the first filter control, the "all types" chip', () => {
    const firstControlRef = createRef<HTMLButtonElement>();
    renderBar({ firstControlRef });

    expect(firstControlRef.current).toBe(
      screen.getByRole('button', { name: es.movements.filters.all }),
    );
  });

  it('shows the English wording', () => {
    renderBar({}, 'en');
    expect(screen.getByLabelText(en.movements.filters.account)).toBeDefined();
  });
});

describe('movements.filters catalogs', () => {
  const KEYS = [
    'account',
    'category',
    'type',
    'from',
    'to',
    'allAccounts',
    'allCategories',
    'all',
    'more',
    'archived',
    'clear',
    'showAll',
    'noMatch',
    'invalidRange',
  ] as const;

  it.each([
    ['es', es],
    ['en', en],
  ] as const)('holds every key in %s, and the row tags label', (_locale, catalog) => {
    for (const key of KEYS) {
      expect(typeof catalog.movements.filters[key], key).toBe('string');
      expect(catalog.movements.filters[key].length).toBeGreaterThan(0);
    }
    expect(catalog.movements.list.tags.length).toBeGreaterThan(0);
  });
});

describe('MovementFilters: hide adjustments (FEAT-012)', () => {
  it('offers an unchecked Hide adjustments control and no adjustment type chip (AC-06)', () => {
    renderBar();

    const box = screen.getByLabelText<HTMLInputElement>(es.movements.filters.hideAdjustments);
    expect(box.checked).toBe(false);
    expect(
      within(screen.getByRole('group', { name: es.movements.filters.type })).queryByText(
        es.movements.types.adjustment,
      ),
    ).toBeNull();
  });

  it('sets hideAdjustments to "true" when checked (AC-06)', async () => {
    const user = userEvent.setup();
    const { onChange } = renderBar();

    await user.click(screen.getByLabelText(es.movements.filters.hideAdjustments));

    expect(onChange).toHaveBeenLastCalledWith({ hideAdjustments: 'true' });
  });

  it('shows the control checked and unsets the filter when unchecked (AC-06)', async () => {
    const user = userEvent.setup();
    const { onChange } = renderBar({ filters: { hideAdjustments: 'true' } });
    const box = screen.getByLabelText<HTMLInputElement>(es.movements.filters.hideAdjustments);

    expect(box.checked).toBe(true);
    await user.click(box);

    expect(onChange).toHaveBeenLastCalledWith({ hideAdjustments: undefined });
  });

  it('reads, writes and sends only "true" or "false" (AC-06)', () => {
    expect(parseFilters(new URLSearchParams('hideAdjustments=true'))).toEqual({
      hideAdjustments: 'true',
    });
    expect(parseFilters(new URLSearchParams('hideAdjustments=yes'))).toEqual({});
    expect(parseFilters(new URLSearchParams('hideAdjustments=1'))).toEqual({});
    expect(serializeFilters({ hideAdjustments: 'true' }).toString()).toBe('hideAdjustments=true');
    expect(filtersToListParams({ hideAdjustments: 'true' })).toEqual({ hideAdjustments: 'true' });
    expect(hasActiveFilters({ hideAdjustments: 'true' })).toBe(true);
  });
});

describe('MovementFilters: active filter chips', () => {
  it('shows each active filter as a chip that takes it off, and counts the ones in the panel', async () => {
    const { onChange, onClear } = renderBar({
      filters: { categoryId: COMIDA, accountId: CAJA, tag: 'Viaje', hideAdjustments: 'true' },
    });

    const chips = screen.getByRole('list', { name: es.movements.filters.active });
    expect(within(chips).getByRole('button', { name: 'Quitar filtro Comida' })).toBeDefined();
    expect(within(chips).getByRole('button', { name: 'Quitar filtro Caja' })).toBeDefined();
    expect(within(chips).getByRole('button', { name: 'Quitar filtro #Viaje' })).toBeDefined();
    expect(screen.getByText('4 filtros activos')).toBeDefined();

    await userEvent.click(within(chips).getByRole('button', { name: 'Quitar filtro Comida' }));
    expect(onChange).toHaveBeenLastCalledWith({
      categoryId: undefined,
      accountId: CAJA,
      tag: 'Viaje',
      hideAdjustments: 'true',
    });
    await userEvent.click(within(chips).getByRole('button', { name: es.movements.filters.clear }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('shows a date range as one chip that clears both days, in the active language', async () => {
    const { onChange, onClear, unmount } = renderBar({
      filters: { from: '2026-09-10', to: '2026-09-20' },
    });

    const chip = screen.getByRole('button', {
      name: /^Quitar filtro Del 10 sept?\.? al 20 sept?\.?$/,
    });
    await userEvent.click(chip);
    expect(onChange).toHaveBeenLastCalledWith({ from: undefined, to: undefined });
    // With only dates on, the clear action is still offered.
    await userEvent.click(screen.getByRole('button', { name: es.movements.filters.clear }));
    expect(onClear).toHaveBeenCalledOnce();
    unmount();

    renderBar({ filters: { from: '2026-09-10' } }, 'en');
    expect(screen.getByRole('button', { name: 'Remove filter From Sep 10' })).toBeDefined();
  });

  it('shows no chips and no count with only a type or nothing chosen', () => {
    renderBar({ filters: { type: 'expense' } });

    expect(screen.queryByRole('list', { name: es.movements.filters.active })).toBeNull();
    expect(screen.queryByText(/filtros? activos?/)).toBeNull();
  });

  it('names a chip by its kind when the chosen id is not among the options', () => {
    renderBar({ filters: { categoryId: uuid(77), accountId: uuid(78) } });

    expect(
      screen.getByRole('button', { name: `Quitar filtro ${es.movements.filters.category}` }),
    ).toBeDefined();
    expect(
      screen.getByRole('button', { name: `Quitar filtro ${es.movements.filters.account}` }),
    ).toBeDefined();
  });
});
