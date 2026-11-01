import type { CardCategoryRule } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { CreditCardDependencies } from './dependencies';

/** The merchant categories the caller taught the statement import (FEAT-016). */
export class ListCardCategoryRules {
  constructor(private readonly deps: Pick<CreditCardDependencies, 'categoryRules'>) {}

  execute(scope: AccessScope): Promise<CardCategoryRule[]> {
    return this.deps.categoryRules.list(scope);
  }
}
