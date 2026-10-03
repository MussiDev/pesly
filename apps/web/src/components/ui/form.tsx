'use client';

import { createContext, useContext, useId, type ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { Input } from './input';
import { Label } from './label';
import { Select } from './select';

/**
 * shadcn/ui-style form field parts, wired through context so label, control, description and
 * message share ids and ARIA attributes. Without react-hook-form: containers own form state.
 */
interface FormItemContextValue {
  id: string;
  invalid: boolean;
  hasDescription: boolean;
}

const FormItemContext = createContext<FormItemContextValue | null>(null);

function useFormItem(): FormItemContextValue {
  const context = useContext(FormItemContext);
  if (!context) throw new Error('Form field parts must be used inside <FormItem>');
  return context;
}

/** The id and ARIA attributes every control gets; it references only the parts that exist. */
function useFieldAria() {
  const { id, invalid, hasDescription } = useFormItem();
  const describedBy = [hasDescription && `${id}-description`, invalid && `${id}-message`]
    .filter(Boolean)
    .join(' ');
  return { id, 'aria-invalid': invalid, 'aria-describedby': describedBy || undefined };
}

/**
 * `invalid` means a `<FormMessage>` with content is rendered; `hasDescription` means a
 * `<FormDescription>` is. The control only references ids that exist.
 */
export function FormItem({
  className,
  invalid = false,
  hasDescription = false,
  ...props
}: ComponentProps<'div'> & { invalid?: boolean; hasDescription?: boolean }) {
  const id = useId();
  return (
    <FormItemContext.Provider value={{ id, invalid, hasDescription }}>
      <div data-slot="form-item" className={cn('grid gap-2', className)} {...props} />
    </FormItemContext.Provider>
  );
}

export function FormLabel({ className, ...props }: ComponentProps<typeof Label>) {
  const { id, invalid } = useFormItem();
  return (
    <Label
      data-slot="form-label"
      data-error={invalid}
      className={cn('data-[error=true]:text-destructive', className)}
      htmlFor={id}
      {...props}
    />
  );
}

export function FormControl(props: ComponentProps<typeof Input>) {
  const aria = useFieldAria();
  return <Input data-slot="form-control" {...aria} {...props} />;
}

/** `FormControl` for a `<select>`: same ids and ARIA wiring. */
export function FormSelect(props: ComponentProps<typeof Select>) {
  const aria = useFieldAria();
  return <Select data-slot="form-control" {...aria} {...props} />;
}

export function FormDescription({ className, ...props }: ComponentProps<'p'>) {
  const { id } = useFormItem();
  return (
    <p
      data-slot="form-description"
      id={`${id}-description`}
      className={cn('text-small text-muted-foreground', className)}
      {...props}
    />
  );
}

export function FormMessage({ className, children, ...props }: ComponentProps<'p'>) {
  const { id } = useFormItem();
  if (!children) return null;
  return (
    <p
      data-slot="form-message"
      id={`${id}-message`}
      className={cn('text-small text-destructive', className)}
      {...props}
    >
      {children}
    </p>
  );
}
