import { CircleAlert } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Alert, AlertDescription, AlertTitle } from './alert';
import { Button } from './button';

interface ErrorStateProps extends Omit<ComponentProps<typeof Alert>, 'title' | 'variant'> {
  /** Already translated by the caller. */
  title: string;
  description?: string;
  retryLabel: string;
  onRetry: () => void;
  /** True while the retry request is in flight: the button is disabled so clicks send one request. */
  retrying?: boolean;
}

/** The shared failure view: an alert with a retry action. */
export function ErrorState({
  title,
  description,
  retryLabel,
  onRetry,
  retrying = false,
  ...props
}: ErrorStateProps) {
  return (
    <Alert variant="destructive" {...props}>
      <CircleAlert aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      {description ? <AlertDescription>{description}</AlertDescription> : null}
      <div className="col-start-2 mt-3">
        <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
          {retryLabel}
        </Button>
      </div>
    </Alert>
  );
}
