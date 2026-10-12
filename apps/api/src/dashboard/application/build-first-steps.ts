import type { DashboardFirstSteps } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { FirstStepsReader } from './ports/first-steps-reader';

export interface FirstStepsDependencies {
  firstSteps: FirstStepsReader;
}

export async function buildFirstSteps(
  deps: FirstStepsDependencies,
  scope: AccessScope,
): Promise<DashboardFirstSteps> {
  const { hasAccount, hasMovement } = await deps.firstSteps.firstStepsOf(scope);
  return { hasAccount, hasMovement, show: !hasAccount || !hasMovement };
}
