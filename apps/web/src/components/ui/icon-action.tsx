import type { ReactNode } from 'react';
import { Button } from './button';

interface IconActionProps {
  /** The action, e.g. "Rename"; also the tooltip. */
  label: string;
  /** What it acts on, e.g. the account name: the accessible name is "<label> <subject>". */
  subject: string;
  icon: ReactNode;
  disabled: boolean;
  onClick: () => void;
}

/** An icon-only row action: the visible part is the icon, the screen-reader name carries the rest. */
export function IconAction({ label, subject, icon, disabled, onClick }: IconActionProps) {
  return (
    <Button size="icon" variant="ghost" title={label} disabled={disabled} onClick={onClick}>
      {icon}
      <span className="sr-only">
        {label} {subject}
      </span>
    </Button>
  );
}
