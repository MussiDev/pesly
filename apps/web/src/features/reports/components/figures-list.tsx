import type { ReactNode } from 'react';

export interface ChartFigureProps {
  name: string;
  summary: string;
  children: ReactNode;
}

/** A named chart container: it exposes the summary and hides the drawing from assistive technology. */
export function ChartFigure({ name, summary, children }: ChartFigureProps) {
  return (
    <figure aria-label={name} className="m-0">
      <figcaption className="sr-only">{summary}</figcaption>
      <div aria-hidden="true">{children}</div>
    </figure>
  );
}
