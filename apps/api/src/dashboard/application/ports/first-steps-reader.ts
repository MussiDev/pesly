import type { AccessScope } from '../../../shared/access';

export interface FirstStepsFacts {
  /** The caller has at least one non-archived account. */
  hasAccount: boolean;
  /** The caller has at least one movement. */
  hasMovement: boolean;
}

export interface FirstStepsReader {
  firstStepsOf(scope: AccessScope): Promise<FirstStepsFacts>;
}
