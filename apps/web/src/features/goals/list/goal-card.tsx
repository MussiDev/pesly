'use client';

import { Link } from '@/i18n/navigation';
import type { GoalView } from '../helpers/goal-view';
import { GoalProgress } from './goal-progress';

/** One goal; the whole card opens its detail. */
export function GoalCard({ goal }: { goal: GoalView }) {
  return (
    <li aria-label={goal.name}>
      <Link
        href={`/goals/${goal.id}`}
        className="grid min-h-11 gap-3 rounded-card bg-card p-4 focus-visible:outline-2"
      >
        <span className="text-body font-medium">{goal.name}</span>
        <GoalProgress goal={goal} />
      </Link>
    </li>
  );
}
