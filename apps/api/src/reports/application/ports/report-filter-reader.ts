import type { AccessScope } from '../../../shared/access';

/** Ownership checks for the optional report filters; unknown and foreign both answer false. */
export interface ReportFilterReader {
  ownsAccount(scope: AccessScope, accountId: string): Promise<boolean>;
  /** The name is compared case-insensitively against the caller's tags. */
  ownsTag(scope: AccessScope, name: string): Promise<boolean>;
}
