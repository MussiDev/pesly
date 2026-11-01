import type { AccessScope } from '../../../shared/access';
import type { DueStatement } from '../../domain/agenda';

export interface CardStatementSource {
  /**
   * The caller's stored statements, of any due date, that still owe money in at least one
   * currency. It reads what is stored and never creates a statement.
   */
  owedStatements(scope: AccessScope, today: string, timeZone: string): Promise<DueStatement[]>;
}
