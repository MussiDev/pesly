import { ResourceNotFound } from '../../shared/access';
import type { GroupSummary } from '../domain/group';
import type { Clock } from './ports/clock';
import type { GroupRepository } from './ports/group-repository';
import type { TokenSource } from './ports/token-source';

export interface ClaimGhostMemberDependencies {
  groups: GroupRepository;
  clock: Clock;
  tokens: TokenSource;
}

export class ClaimGhostMember {
  constructor(private readonly deps: ClaimGhostMemberDependencies) {}

  /**
   * The token is the credential, so there is no membership guard. The repository marks the link
   * used and rebinds the ghost in one transaction, keeping the member id and `joined_at` (AC-12).
   */
  async execute(userId: string, rawToken: string): Promise<GroupSummary> {
    const member = await this.deps.groups.claimGhost({
      tokenHash: this.deps.tokens.hash(rawToken),
      userId,
      now: this.deps.clock.now(),
    });
    const summary = await this.deps.groups.getSummary(member.groupId, userId);
    if (summary === null) throw new ResourceNotFound();
    return summary;
  }
}
