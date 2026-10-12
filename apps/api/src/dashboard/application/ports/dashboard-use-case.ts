import type { DashboardResponse } from '@pesly/shared';
import type { AccessScope } from '../../../shared/access';

export interface DashboardUseCase {
  execute(scope: AccessScope<'read'>): Promise<DashboardResponse>;
}
