import { AppError } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type {
  ExpenseSavedEvent,
  ExpenseSavedHook,
  ExpenseSavedListener,
} from './ports/expense-saved-listener';

export const EXPENSE_SAVED_TIMEOUT_MS = 2_000;

/** Never the error object: a driver error carries statement parameters (budget names). */
export interface ExpenseSavedFailure {
  errorName: string;
  errorCode: string | undefined;
  userId: string;
}

function describeFailure(error: unknown, userId: string): ExpenseSavedFailure {
  if (error instanceof AppError) return { errorName: error.name, errorCode: error.code, userId };
  if (error instanceof Error) {
    // Drizzle wraps the driver error: the SQLSTATE sits on `cause`, never in the logged message.
    const code =
      (error as { code?: unknown }).code ?? (error.cause as { code?: unknown } | undefined)?.code;
    return {
      errorName: error.name,
      errorCode: typeof code === 'string' ? code : undefined,
      userId,
    };
  }
  return { errorName: 'UnknownError', errorCode: undefined, userId };
}

/**
 * Awaits the listener for at most `EXPENSE_SAVED_TIMEOUT_MS` and never throws. A failure, or the
 * time bound, goes to `reportFailure`; an evaluation that outlives the bound keeps running and a
 * later rejection is reported too, so none is left unhandled.
 */
export class BestEffortExpenseSavedHook implements ExpenseSavedHook {
  constructor(
    private readonly listener: ExpenseSavedListener,
    private readonly reportFailure: (failure: ExpenseSavedFailure) => void,
    private readonly timeoutMs: number = EXPENSE_SAVED_TIMEOUT_MS,
  ) {}

  async run(scope: AccessScope<'write'>, event: ExpenseSavedEvent): Promise<void> {
    const userId = scope.userId;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const state = { timedOut: false };
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        state.timedOut = true;
        resolve();
      }, this.timeoutMs);
    });
    const evaluation = Promise.resolve()
      .then(() => this.listener.afterExpenseSaved(scope, event))
      .catch((error: unknown) => {
        this.reportFailure(describeFailure(error, userId));
      });
    try {
      await Promise.race([evaluation, timeout]);
    } finally {
      clearTimeout(timer);
    }
    if (state.timedOut) {
      this.reportFailure({ errorName: 'ExpenseSavedTimeout', errorCode: 'TIMEOUT', userId });
    }
  }
}
