// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inbox } from 'lucide-react';
import { formatMoney } from '@pesly/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Alert, AlertDescription, AlertTitle } from '../src/components/ui/alert';
import { Amount } from '../src/components/ui/amount';
import { Badge } from '../src/components/ui/badge';
import { Button, buttonVariants } from '../src/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../src/components/ui/card';
import { Checkbox } from '../src/components/ui/checkbox';
import { EmptyState } from '../src/components/ui/empty-state';
import { ErrorState } from '../src/components/ui/error-state';
import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
  FormSelect,
} from '../src/components/ui/form';
import { Input } from '../src/components/ui/input';
import { Label } from '../src/components/ui/label';
import { ListRow } from '../src/components/ui/list-row';
import { PageHeader } from '../src/components/ui/page-header';
import { Select } from '../src/components/ui/select';
import { Skeleton } from '../src/components/ui/skeleton';

afterEach(cleanup);

describe('Button', () => {
  it.each(['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const)(
    'renders the %s variant from tokens with a visible focus ring',
    (variant) => {
      render(<Button variant={variant}>Go</Button>);

      const classes = screen.getByRole('button', { name: 'Go' }).className;
      expect(classes).toMatch(/focus-visible:ring-2/);
      expect(classes).toMatch(/focus-visible:ring-ring/);
    },
  );

  it.each(['default', 'sm', 'lg', 'icon'] as const)('keeps a 44px target in size %s', (size) => {
    render(<Button size={size}>Go</Button>);

    const classes = screen.getByRole('button', { name: 'Go' }).className;
    expect(classes).toMatch(size === 'icon' ? /size-11/ : /min-h-11/);
  });

  it('keeps its exported API: type defaults to button, buttonVariants styles links', () => {
    render(
      <>
        <Button>Plain</Button>
        <a href="/x" className={buttonVariants({ variant: 'outline' })}>
          Link
        </a>
      </>,
    );

    expect(screen.getByRole('button', { name: 'Plain' }).getAttribute('type')).toBe('button');
    expect(screen.getByRole('link', { name: 'Link' }).className).toMatch(/border/);
  });

  it('does not fire while disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Go' }));

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('form controls', () => {
  it('Input and Select keep a 44px target and a focus ring', () => {
    render(
      <>
        <Input aria-label="text" />
        <Select aria-label="choice">
          <option>One</option>
        </Select>
      </>,
    );

    for (const name of ['text', 'choice']) {
      const el = screen.getByLabelText(name);
      expect(el.className, name).toMatch(/min-h-11/);
      expect(el.className, name).toMatch(/focus-visible:ring-2/);
    }
  });

  it('Checkbox keeps a 44px hit area, a focus ring and its native behaviour', async () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="flag" checked={false} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'flag' });

    await userEvent.setup().click(box);

    // Visible box is 20px; the ::after pseudo-element extends the hit area by 12px per side (44px).
    expect(box.className).toMatch(/(^| )size-5( |$)/);
    expect(box.className).toMatch(/appearance-none/);
    expect(box.className).toMatch(/after:-inset-3/);
    expect(box.className).not.toMatch(/min-h-11|min-w-11|size-11/);
    expect(box.className).toMatch(/focus-visible:ring-2/);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('marks an invalid control with the destructive token', () => {
    render(<Input aria-label="bad" aria-invalid />);

    expect(screen.getByLabelText('bad').className).toMatch(/aria-invalid:border-destructive/);
  });

  it('Form parts still wire label, control, description and message', () => {
    render(
      <FormItem invalid hasDescription>
        <FormLabel>Email</FormLabel>
        <FormControl />
        <FormDescription>Hint</FormDescription>
        <FormMessage>Required</FormMessage>
      </FormItem>,
    );

    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain('description');
    expect(input.getAttribute('aria-describedby')).toContain('message');
    expect(screen.getByText('Required').className).toMatch(/text-destructive/);
  });

  it('FormSelect and Label keep their API', () => {
    render(
      <FormItem>
        <Label htmlFor="x">Other</Label>
        <FormSelect aria-label="Currency">
          <option>ARS</option>
        </FormSelect>
      </FormItem>,
    );

    expect(screen.getByRole('combobox', { name: 'Currency' })).toBeTruthy();
    expect(screen.getByText('Other').tagName).toBe('LABEL');
  });
});

describe('Card', () => {
  it('composes header, title and content on the card token with a hairline border', () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle as="h2">Title</CardTitle>
        </CardHeader>
        <CardContent>Body</CardContent>
      </Card>,
    );

    expect(screen.getByTestId('card').className).toMatch(/bg-card/);
    expect(screen.getByTestId('card').className).toMatch(/\bborder\b/);
    expect(screen.getByRole('heading', { level: 2, name: 'Title' })).toBeTruthy();
  });
});

describe('Alert', () => {
  it.each(['default', 'destructive', 'success', 'warning', 'info'] as const)(
    'renders the %s variant as an alert',
    (variant) => {
      render(
        <Alert variant={variant}>
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>Details</AlertDescription>
        </Alert>,
      );

      const alert = screen.getByRole('alert');
      expect(alert.getAttribute('data-slot')).toBe('alert');
      if (variant !== 'default') expect(alert.className).toContain(`border-${variant}`);
    },
  );
});

describe('Badge', () => {
  it.each(['default', 'success', 'warning', 'info', 'destructive', 'outline'] as const)(
    'renders the %s variant',
    (variant) => {
      render(<Badge variant={variant}>Tag</Badge>);

      expect(screen.getByText('Tag').getAttribute('data-slot')).toBe('badge');
    },
  );
});

describe('Skeleton (AC-21)', () => {
  it('renders a pulsing placeholder hidden from assistive technology', () => {
    render(<Skeleton data-testid="sk" className="h-4 w-20" />);

    const sk = screen.getByTestId('sk');
    expect(sk.className).toMatch(/animate-pulse/);
    expect(sk.className).toMatch(/bg-muted/);
    expect(sk.className).toContain('h-4');
    expect(sk.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('EmptyState (AC-22)', () => {
  it('renders already-translated title, description, icon and call to action', () => {
    render(
      <EmptyState
        icon={<Inbox aria-hidden data-testid="icon" />}
        title="No accounts"
        description="Create your first one."
        action={<Button>Create account</Button>}
      />,
    );

    expect(screen.getByRole('heading', { name: 'No accounts' })).toBeTruthy();
    expect(screen.getByText('Create your first one.')).toBeTruthy();
    expect(screen.getByTestId('icon')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy();
  });

  it('renders with only a title', () => {
    render(<EmptyState title="Nothing" />);

    expect(screen.getByRole('heading', { name: 'Nothing' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ErrorState', () => {
  it('is built on Alert and retries once per click', async () => {
    const onRetry = vi.fn();
    render(
      <ErrorState
        title="Failed"
        description="Could not load."
        retryLabel="Try again"
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert').getAttribute('data-slot')).toBe('alert');
    expect(screen.getByText('Failed')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('disables the retry button while a request is in flight (R-08)', async () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Failed" retryLabel="Try again" onRetry={onRetry} retrying />);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Try again' });

    await userEvent.setup().click(button);

    expect(button.disabled).toBe(true);
    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe('PageHeader', () => {
  it('renders the page heading, description and actions', () => {
    render(
      <PageHeader title="Accounts" description="All your money." actions={<Button>New</Button>} />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Accounts' })).toBeTruthy();
    expect(screen.getByText('All your money.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New' })).toBeTruthy();
  });
});

describe('ListRow', () => {
  it('lays out leading, title, description and trailing with a 44px minimum', () => {
    render(
      <ListRow
        data-testid="row"
        leading={<span>L</span>}
        title="Salary"
        description="Today"
        trailing={<span>T</span>}
      />,
    );

    expect(screen.getByText('Salary')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('L')).toBeTruthy();
    expect(screen.getByText('T')).toBeTruthy();
    expect(screen.getByTestId('row').className).toMatch(/min-h-11/);
  });

  it('can be a list item; an interactive row only styles hover and never fakes a focus ring', () => {
    render(
      <ul>
        <ListRow as="li" interactive title="Row" />
      </ul>,
    );

    const item = screen.getByRole('listitem');
    expect(item.className).toMatch(/hover:bg-surface/);
    expect(item.className).not.toMatch(/focus-visible:ring/);
    expect(item.hasAttribute('tabindex')).toBe(false);
  });
});

describe('Amount (AC-02, AC-04)', () => {
  const glyph = (el: HTMLElement) => el.querySelector('[aria-hidden="true"]');
  const spoken = (el: HTMLElement) => el.querySelector('.sr-only');

  it('uses the shared money format, the same one the accounts and movements screens show', () => {
    render(
      <>
        <Amount value={18500000n} currency="ARS" locale="es" data-testid="es" />
        <Amount value={123456n} currency="USD" locale="en" data-testid="en" />
      </>,
    );

    expect(screen.getByTestId('es').textContent).toBe(formatMoney(18500000n, 'ARS', 'es'));
    expect(screen.getByTestId('en').textContent).toBe(formatMoney(123456n, 'USD', 'en'));
  });

  it('shows a plus sign for income and a minus sign for expense, not colour alone', () => {
    render(
      <>
        <Amount value={123456n} currency="ARS" locale="en" kind="income" data-testid="in" />
        <Amount value={123456n} currency="ARS" locale="en" kind="expense" data-testid="out" />
      </>,
    );

    const formatted = formatMoney(123456n, 'ARS', 'en');
    expect(screen.getByTestId('in').textContent).toBe(`+${formatted}`);
    expect(screen.getByTestId('out').textContent).toBe(`−${formatted}`);
    expect(screen.getByTestId('in').className).toMatch(/text-income/);
    expect(screen.getByTestId('out').className).toMatch(/text-expense/);
  });

  it('hides the visual glyph from assistive technology and speaks the direction label', () => {
    render(
      <Amount
        value={500n}
        currency="ARS"
        locale="en"
        kind="expense"
        directionLabel="Expense"
        data-testid="a"
      />,
    );
    const el = screen.getByTestId('a');

    expect(glyph(el)?.textContent).toBe('−');
    expect(spoken(el)?.textContent).toBe('Expense');
  });

  it.each(['income', 'expense'] as const)('renders a plain zero with no sign for %s', (kind) => {
    render(
      <Amount
        value={0n}
        currency="ARS"
        locale="en"
        kind={kind}
        directionLabel="Direction"
        data-testid="zero"
      />,
    );
    const el = screen.getByTestId('zero');

    expect(el.textContent).toBe(formatMoney(0n, 'ARS', 'en'));
    expect(el.textContent).not.toMatch(/[+−-]0|^[+−]/);
    expect(glyph(el)).toBeNull();
    expect(spoken(el)).toBeNull();
    expect(el.className).not.toMatch(/text-income|text-expense/);
  });

  it('applies tabular numerals', () => {
    render(<Amount value={1n} currency="USD" locale="es" data-testid="a" />);

    expect(screen.getByTestId('a').className).toMatch(/tabular-nums/);
  });

  it('keeps the sign of a negative neutral amount and never doubles it', () => {
    render(
      <>
        <Amount value={-500n} currency="ARS" locale="en" data-testid="neg" />
        <Amount value={-500n} currency="ARS" locale="en" kind="expense" data-testid="exp" />
      </>,
    );

    expect(screen.getByTestId('neg').textContent).toBe(formatMoney(-500n, 'ARS', 'en'));
    expect(screen.getByTestId('exp').textContent).toBe(`−${formatMoney(500n, 'ARS', 'en')}`);
  });
});

describe('interactive components show a focus indicator on keyboard focus (AC-23)', () => {
  it('every interactive primitive carries a focus-visible ring token', () => {
    render(
      <>
        <Button>b</Button>
        <Input aria-label="i" />
        <Select aria-label="s">
          <option>x</option>
        </Select>
        <Checkbox aria-label="c" />
      </>,
    );

    const elements = [
      screen.getByRole('button'),
      screen.getByLabelText('i'),
      screen.getByLabelText('s'),
      screen.getByLabelText('c'),
    ];
    for (const el of elements) expect(el.className).toMatch(/focus-visible:ring-ring/);
  });
});
