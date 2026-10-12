import type { AccessScope } from '../../../shared/access';
import type { DueStatement } from '../../domain/agenda';

export interface CardStatementSource {
  /**
   * The caller's stored statements with a due date up to `today` + 7 that still owe money in at
   * least one currency. It reads what is stored and never creates a statement.
   */
  dueStatements(scope: AccessScope, today: string, timeZone: string): Promise<DueStatement[]>;
}
