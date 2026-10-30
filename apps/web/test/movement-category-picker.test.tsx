// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import es from '../messages/es.json';
import { CategoryChips } from '../src/features/movements/components/category-chips';
import {
  readLastAccount,
  startingAccount,
  writeLastAccount,
} from '../src/features/movements/last-account';

afterEach(cleanup);

const OPTIONS = [
  { id: 'food', label: 'Comida', parentId: null, icon: 'utensils', color: 'orange' },
  { id: 'groceries', label: 'Supermercado', parentId: 'food' },
  { id: 'delivery', label: 'Delivery', parentId: 'food' },
  { id: 'transport', label: 'Transporte', parentId: null, icon: 'car', color: 'blue' },
  // Its parent is not offered (archived): it stands on its own.
  { id: 'orphan', label: 'Huérfana', parentId: 'archived-parent' },
];

function picker(defaultValue = '') {
  return render(
    <NextIntlClientProvider locale="es" timeZone="UTC" messages={es}>
      <form>
        <CategoryChips
          label={es.movements.fields.category}
          categories={OPTIONS}
          defaultValue={defaultValue}
          invalid={false}
          describedBy={undefined}
        />
      </form>
    </NextIntlClientProvider>,
  );
}

const picked = () =>
  document.querySelector<HTMLInputElement>('input[name="categoryId"]:checked')?.value;

describe('CategoryChips as a grid of top-level tiles', () => {
  it('shows the top-level categories, and orphans, as tiles; subcategories stay folded', () => {
    picker();

    for (const name of ['Comida', 'Transporte', 'Huérfana']) {
      expect(screen.getByRole('radio', { name })).toBeDefined();
    }
    expect(screen.queryByRole('radio', { name: 'Supermercado' })).toBeNull();
  });

  it('opens the subcategories of a picked tile and lets one be picked instead', async () => {
    picker();

    await userEvent.click(screen.getByText('Comida'));
    expect(picked()).toBe('food');
    const group = screen.getByRole('group', { name: 'Subcategorías de Comida' });
    await userEvent.click(within(group).getByText('Supermercado'));

    expect(picked()).toBe('groceries');
    // The group stays open while one of its subcategories is the pick.
    expect(screen.getByRole('group', { name: 'Subcategorías de Comida' })).toBeDefined();
    await userEvent.click(screen.getByText('Transporte'));
    expect(picked()).toBe('transport');
    expect(screen.queryByRole('group', { name: 'Subcategorías de Comida' })).toBeNull();
  });

  it('starts with the parent of a stored subcategory open', () => {
    picker('delivery');

    expect(picked()).toBe('delivery');
    expect(screen.getByRole('radio', { name: 'Delivery' })).toBeDefined();
  });
});

describe('the account a new movement starts on', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const accounts = [
    { id: 'usd', currency: 'USD' },
    { id: 'pesos', currency: 'ARS' },
    { id: 'more-pesos', currency: 'ARS' },
  ];

  it('is the last account used, remembered per user', () => {
    writeLastAccount('ana', 'more-pesos');

    expect(readLastAccount('ana')).toBe('more-pesos');
    expect(readLastAccount('bob')).toBeUndefined();
    expect(startingAccount(accounts, readLastAccount('ana'))).toBe('more-pesos');
  });

  it('falls back to the first peso account, then the first account, then none', () => {
    expect(startingAccount(accounts, 'gone')).toBe('pesos');
    expect(startingAccount([{ id: 'usd', currency: 'USD' }], undefined)).toBe('usd');
    expect(startingAccount([], undefined)).toBeUndefined();
  });

  it('remembers nothing without a signed-in user', () => {
    writeLastAccount(undefined, 'pesos');

    expect(readLastAccount(undefined)).toBeUndefined();
    expect(localStorage.length).toBe(0);
  });
});
