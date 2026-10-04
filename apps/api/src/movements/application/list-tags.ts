import { AppError, LIST_TAGS_MAX_LIMIT } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { TagRepository } from './ports/tag-repository';

export interface ListTagsDependencies {
  tags: TagRepository;
}

/** Every tag of the caller, a page at a time: what the device keeps to offer tags without a network. */
export class ListTags {
  constructor(private readonly deps: ListTagsDependencies) {}

  async execute(
    scope: AccessScope<'read'>,
    input: { limit: number; offset: number },
  ): Promise<{ items: string[]; total: number }> {
    const { limit, offset } = input;
    if (!Number.isInteger(limit) || limit < 1 || limit > LIST_TAGS_MAX_LIMIT) {
      throw new AppError('VALIDATION_FAILED', 'limit out of range');
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new AppError('VALIDATION_FAILED', 'offset out of range');
    }
    return this.deps.tags.listAll(scope, { limit, offset });
  }
}
