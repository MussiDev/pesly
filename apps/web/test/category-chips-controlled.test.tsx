// @vitest-environment happy-dom
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CategoryChips } from '../src/features/movements/components/category-chips';
import { renderApp } from './support/render-app';

afterEach(cleanup);

const CATEGORIES = [
  { id: 'rent', label: 'Rent', icon: 'home', color: 'blue' },
  { id: 'food', label: 'Food', icon: 'utensils', color: 'orange' },
];

describe('CategoryChips, controlled', () => {
  it('follows `value`, reports picks and uses its own radio name', async () => {
    const onChange = vi.fn();
    renderApp(
      <CategoryChips
        label="Category"
        name="groupCategoryId"
        categories={CATEGORIES}
        defaultValue=""
        value="rent"
        onChange={onChange}
        invalid={false}
        describedBy={undefined}
      />,
    );

    const rent = screen.getByRole<HTMLInputElement>('radio', { name: 'Rent' });
    expect(rent.checked).toBe(true);
    expect(rent.name).toBe('groupCategoryId');
    await userEvent.click(screen.getByRole('radio', { name: 'Food' }));
    expect(onChange).toHaveBeenCalledWith('food');
  });

  it('error: two pickers in one form keep separate choices', async () => {
    renderApp(
      <form>
        <CategoryChips
          label="Group category"
          name="groupCategoryId"
          categories={CATEGORIES}
          defaultValue="rent"
          invalid={false}
          describedBy={undefined}
        />
        <CategoryChips
          label="Your category"
          name="personalCategoryId"
          categories={CATEGORIES.map((c) => ({ ...c, id: `p-${c.id}` }))}
          defaultValue=""
          invalid={false}
          describedBy={undefined}
        />
      </form>,
    );

    const [, personalFood] = screen.getAllByRole<HTMLInputElement>('radio', { name: 'Food' });
    await userEvent.click(personalFood as HTMLInputElement);
    expect(screen.getAllByRole<HTMLInputElement>('radio', { name: 'Rent' })[0]?.checked).toBe(true);
    expect(personalFood?.checked).toBe(true);
  });
});
