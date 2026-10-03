import { AppError } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { TagRepository } from './ports/tag-repository';

export const SUGGEST_TAGS_MAX_LIMIT = 20;

export interface SuggestTagsDependencies {
  tags: TagRepository;
}

export class SuggestTags {
  constructor(private readonly deps: SuggestTagsDependencies) {}

  async execute(
    scope: AccessScope<'read'>,
    input: { prefix: string; limit: number },
  ): Promise<string[]> {
    const { prefix, limit } = input;
    if (!Number.isInteger(limit) || limit < 1 || limit > SUGGEST_TAGS_MAX_LIMIT) {
      throw new AppError('VALIDATION_FAILED', 'limit out of range');
    }
    return this.deps.tags.suggest(scope, prefix, limit);
  }
}
