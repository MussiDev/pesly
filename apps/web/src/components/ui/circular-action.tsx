import { cva } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The outer element of a circular action. Also usable on a link, the way `buttonVariants` is:
 * `<Link className={circularActionVariants()}><CircularActionFace .../></Link>`.
 */
export const circularActionVariants = cva(
  'group flex min-w-circle-action flex-col items-center gap-1.5 rounded-lg text-caption font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
);

const TONES = {
  primary: 'bg-primary text-primary-foreground group-hover:bg-primary/90',
  secondary: 'bg-card text-primary shadow-xs group-hover:bg-accent',
} as const;

interface CircularActionFaceProps {
  icon: ReactNode;
  label: string;
  tone?: keyof typeof TONES;
}

/** The circle and the label under it. The icon is decorative: the label is the accessible name. */
export function CircularActionFace({ icon, label, tone = 'secondary' }: CircularActionFaceProps) {
  return (
    <>
      <span
        aria-hidden="true"
        data-slot="circular-action-circle"
        className={cn(
          'flex size-circle-action items-center justify-center rounded-pill transition-colors motion-reduce:transition-none [&>svg]:size-5',
          TONES[tone],
        )}
      >
        {icon}
      </span>
      <span>{label}</span>
    </>
  );
}

interface CircularActionProps
  extends Omit<ComponentProps<'button'>, 'children'>, CircularActionFaceProps {}

export function CircularAction({
  icon,
  label,
  tone,
  className,
  type = 'button',
  ...props
}: CircularActionProps) {
  return (
    <button
      data-slot="circular-action"
      type={type}
      className={cn(circularActionVariants(), className)}
      {...props}
    >
      <CircularActionFace icon={icon} label={label} tone={tone} />
    </button>
  );
}
