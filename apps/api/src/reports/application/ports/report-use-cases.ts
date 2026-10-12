import type {
  ExpensesByCategoryResponse,
  IncomeExpensesResponse,
  NetWorthQuery,
  NetWorthResponse,
  ReportFlowQuery,
} from '@pesly/shared';
import type { AccessScope } from '../../../shared/access';

export interface ReportUseCase<Query, Response> {
  execute(scope: AccessScope, query: Query): Promise<Response>;
}

export interface ReportUseCases {
  expensesByCategory: ReportUseCase<ReportFlowQuery, ExpensesByCategoryResponse>;
  incomeExpenses: ReportUseCase<ReportFlowQuery, IncomeExpensesResponse>;
  netWorth: ReportUseCase<NetWorthQuery, NetWorthResponse>;
}
