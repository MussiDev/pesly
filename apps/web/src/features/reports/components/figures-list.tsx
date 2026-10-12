import type { ReactNode } from 'react';

export interface FigureRow {
  key: string;
  label: string;
  value: string;
  note?: string | undefined;
}

export interface FiguresListProps {
  label: string;
  rows: readonly FigureRow[];
}

/** The native text alternative of a chart: one row per figure, same numbers as the drawing. */
export function FiguresList({ label, rows }: FiguresListProps) {
  return (
    <ul aria-label={label} className="grid gap-1 text-small">
      {rows.map((row) => (
        <li
          key={row.key}
          className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1"
        >
          <span>{row.label}</span>
          <span className="flex flex-wrap items-center gap-x-2 tabular-nums">
            {row.note === undefined ? null : (
              <span className="text-muted-foreground">{row.note}</span>
            )}
            <span>{row.value}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

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
