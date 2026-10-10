import { INVITATION_TTL_MS } from '../domain/group';
import { GroupAccess } from './group-access';
import type { Clock } from './ports/clock';
import type { GroupRepository } from './ports/group-repository';
import type { TokenSource } from './ports/token-source';

export interface CreateInvitationDependencies {
  groups: GroupRepository;
  clock: Clock;
  tokens: TokenSource;
}

export interface CreatedInvitation {
  /** Raw token, shown once; only its hash is stored. */
  token: string;
  expiresAt: Date;
}

export class CreateInvitation {
  private readonly access: GroupAccess;

  constructor(private readonly deps: CreateInvitationDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /** Any member. Replaces the member's previous invitation, which stops working (spec D16). */
  async execute(userId: string, groupId: string): Promise<CreatedInvitation> {
    const member = await this.access.member(userId, groupId);
    const issued = this.deps.tokens.generate();
    const expiresAt = new Date(this.deps.clock.now().getTime() + INVITATION_TTL_MS);
    await this.deps.groups.upsertInvitation({
      groupId,
      memberId: member.id,
      tokenHash: issued.hash,
      expiresAt,
    });
    return { token: issued.raw, expiresAt };
  }
}
