// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Trash2 } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormActions } from '../src/components/ui/form';
import { IconAction } from '../src/components/ui/icon-action';

afterEach(cleanup);

describe('IconAction', () => {
  it('is icon-only with a tooltip by default, and names its subject to screen readers', async () => {
    const onClick = vi.fn();
    render(
      <IconAction
        label="Archive"
        subject="Cash"
        icon={<Trash2 />}
        disabled={false}
        onClick={onClick}
      />,
    );

    const button = screen.getByRole('button', { name: 'Archive Cash' });
    expect(button.getAttribute('title')).toBe('Archive');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows its label on touch-friendly rows, with no tooltip and the same accessible name', () => {
    render(
      <IconAction
        showLabel
        tone="destructive"
        label="Delete"
        subject="Cash"
        icon={<Trash2 />}
        disabled={false}
        onClick={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: 'Delete Cash' });
    expect(button.getAttribute('title')).toBeNull();
    expect(button.textContent).toContain('Delete');
    expect(button.className).toContain('text-destructive');
  });

  it('error: a disabled action does not run', async () => {
    const onClick = vi.fn();
    render(
      <IconAction label="Archive" subject="Cash" icon={<Trash2 />} disabled onClick={onClick} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Archive Cash' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('FormActions', () => {
  it('sticks to the bottom only on a task page and below the desk breakpoint', () => {
    const { container } = render(
      <FormActions>
        <button type="submit">Save</button>
      </FormActions>,
    );
    const row = container.querySelector('[data-slot="form-actions"]');
    expect(row?.className).toContain('max-desk:in-data-task:sticky');
    expect(row?.className).not.toMatch(/(^|\s)sticky(\s|$)/);
  });
});
