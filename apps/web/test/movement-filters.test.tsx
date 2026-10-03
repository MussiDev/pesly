// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
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
        `accountId=nope&categoryId=${COMIDA}&from=2026-13-45&to=31-10-2026&type=transfer&tag=%20%20`,
      ),
    ).toEqual({ categoryId: COMIDA });
    expect(read(`tag=${'a'.repeat(31)}`)).toEqual({});
    expect(read('from=&to=')).toEqual({});
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
    expect(optionTexts(screen.getByLabelText(es.movements.filters.type))).toEqual([
      es.movements.filters.allTypes,
      es.movements.types.expense,
      es.movements.types.income,
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
    await user.selectOptions(screen.getByLabelText(es.movements.filters.type), 'income');
    expect(onChange).toHaveBeenLastCalledWith({ tag: 'Viaje', type: 'income' });
    fireEvent.change(screen.getByLabelText(es.movements.filters.from), {
      target: { value: '2026-10-01' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ tag: 'Viaje', from: '2026-10-01' });

    await user.click(screen.getByRole('button', { name: es.movements.filters.clear }));
    expect(onClear).toHaveBeenCalledTimes(1);
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
    const from = screen.getByLabelText(es.movements.filters.from);
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
    'allTypes',
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
