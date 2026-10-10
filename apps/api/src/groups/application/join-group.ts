import { ResourceNotFound } from '../../shared/access';
import { MAX_GROUP_MEMBERS, type GroupSummary } from '../domain/group';
import type { Clock } from './ports/clock';
import type { GroupRepository } from './ports/group-repository';
import type { TokenSource } from './ports/token-source';

export interface JoinGroupDependencies {
  groups: GroupRepository;
  clock: Clock;
  tokens: TokenSource;
}

export class JoinGroup {
  constructor(private readonly deps: JoinGroupDependencies) {}

  /**
   * The caller is not yet a member, so there is no membership guard: the token is the credential.
   * The repository does the lookup, the expiry check and the insert atomically.
   */
  async execute(userId: string, rawToken: string): Promise<GroupSummary> {
    const member = await this.deps.groups.acceptInvitation({
      tokenHash: this.deps.tokens.hash(rawToken),
      userId,
      now: this.deps.clock.now(),
      limit: MAX_GROUP_MEMBERS,
    });
    const summary = await this.deps.groups.getSummary(member.groupId, userId);
    if (summary === null) throw new ResourceNotFound();
    return summary;
  }
}
