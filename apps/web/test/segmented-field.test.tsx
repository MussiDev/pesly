// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SegmentedField } from '../src/components/ui/segmented-field';

afterEach(cleanup);

const OPTIONS = [
  { value: 'ARS', label: 'ARS' },
  { value: 'USD', label: 'USD' },
] as const;

describe('SegmentedField', () => {
  it('shows every option as a radio named by the field, read by the form like a select', async () => {
    const onSubmit = vi.fn((event: SubmitEvent) => {
      event.preventDefault();
      return new FormData(event.target as HTMLFormElement).get('currency');
    });
    render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent)}>
        <SegmentedField label="Currency" name="currency" options={OPTIONS} defaultValue="ARS" />
        <button type="submit">Save</button>
      </form>,
    );

    const group = screen.getByRole('radiogroup', { name: 'Currency' });
    expect(group).toBeDefined();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'ARS' }).checked).toBe(true);
    await userEvent.click(screen.getByText('USD'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit.mock.results[0]?.value).toBe('USD');
  });

  it('follows a controlled value and reports each pick', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedField
        label="Currency"
        name="currency"
        options={OPTIONS}
        value="USD"
        onChange={onChange}
      />,
    );

    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'USD' }).checked).toBe(true);
    await userEvent.click(screen.getByRole('radio', { name: 'ARS' }));
    expect(onChange).toHaveBeenCalledWith('ARS');
  });

  it('starts with nothing checked when no default is given', () => {
    render(<SegmentedField label="Currency" name="currency" options={OPTIONS} />);
    expect(screen.getAllByRole<HTMLInputElement>('radio').some((radio) => radio.checked)).toBe(
      false,
    );
  });

  it('error: announces the error with the group and marks it invalid', () => {
    render(
      <SegmentedField
        label="Currency"
        name="currency"
        options={OPTIONS}
        hint="Pick one"
        error="Choose ARS or USD."
      />,
    );

    const group = screen.getByRole('radiogroup', { name: 'Currency' });
    expect(group.getAttribute('aria-invalid')).toBe('true');
    const describedBy = group.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(describedBy).toHaveLength(2);
    expect(screen.getByText('Choose ARS or USD.').id).toBe(describedBy[1]);
  });

  it('error: a disabled option or field cannot be picked', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SegmentedField
        label="Currency"
        name="currency"
        options={[{ value: 'ARS', label: 'ARS', disabled: true }, OPTIONS[1]]}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'ARS' }));
    expect(onChange).not.toHaveBeenCalled();

    rerender(
      <SegmentedField
        label="Currency"
        name="currency"
        options={OPTIONS}
        disabled
        onChange={onChange}
      />,
    );
    expect(screen.getAllByRole<HTMLInputElement>('radio').every((radio) => radio.disabled)).toBe(
      true,
    );
  });
});
