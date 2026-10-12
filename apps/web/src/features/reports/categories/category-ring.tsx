import { DonutChart, type DonutSegment } from '@/components/ui/donut-chart';
import type { CategoryRowView, RingSegmentView } from '../report-view';

export interface CategoryRingProps {
  label: string;
  segments: readonly RingSegmentView[];
  /** The rows the segments were made from, already carrying their whole-percent shares. */
  rows: readonly CategoryRowView[];
  /** The whole-percent text of a share, `<1%` included. */
  percentText: (percent: number, underOne: boolean) => string;
}

/** Room for the segment index below the amount in the donut's weight; a ring has at most 6. */
const INDEX_SLOTS = 1000n;

/**
 * The ring of the largest categories. The donut prints one legend share per weight, so each weight
 * carries its segment index in the lowest digits: the share text is then looked up exactly, even
 * for two segments with the same amount. The weights only size the arcs.
 */
export function CategoryRing({ label, segments, rows, percentText }: CategoryRingProps) {
  const positive = rows.filter((row) => row.amount > 0n);
  const texts = segments.map((segment, index) => {
    if (!segment.isRest) {
      const row = positive[index];
      return percentText(row?.percent ?? 0, row?.underOne ?? false);
    }
    const percent = positive.slice(index).reduce((sum, row) => sum + row.percent, 0);
    return percentText(percent, percent === 0);
  });
  const donut: DonutSegment[] = segments.map((segment, index) => ({
    key: segment.key,
    label: segment.label,
    basisPoints: segment.amount * INDEX_SLOTS + BigInt(index),
  }));

  return (
    <DonutChart
      className="flex-wrap [&>ul]:min-w-40"
      label={label}
      segments={donut}
      formatPercent={(weight) => texts[Number(BigInt(weight) % INDEX_SLOTS)] ?? ''}
    />
  );
}
