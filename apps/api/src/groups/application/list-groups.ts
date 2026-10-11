import type { GroupSummary } from '../domain/group';
import type { GroupRepository } from './ports/group-repository';

export interface ListGroupsDependencies {
  groups: GroupRepository;
}

export class ListGroups {
  constructor(private readonly deps: ListGroupsDependencies) {}

  /** Only the groups the caller belongs to. */
  async execute(userId: string): Promise<GroupSummary[]> {
    return this.deps.groups.listForUser(userId);
  }
}
