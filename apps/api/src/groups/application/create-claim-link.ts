import { ResourceNotFound } from '../../shared/access';
import { isGhost } from '../domain/member';
import { GroupAccess } from './group-access';
import type { GroupRepository } from './ports/group-repository';
import type { TokenSource } from './ports/token-source';

export interface CreateClaimLinkDependencies {
  groups: GroupRepository;
  tokens: TokenSource;
}

export interface CreatedClaimLink {
  /** Raw token, shown once; only its hash is stored. */
  token: string;
}

export class CreateClaimLink {
  private readonly access: GroupAccess;

  constructor(private readonly deps: CreateClaimLinkDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /** Any member. The target must be a ghost of the group, otherwise 404; a new link replaces the old (D5). */
  async execute(userId: string, groupId: string, memberId: string): Promise<CreatedClaimLink> {
    await this.access.member(userId, groupId);
    const target = await this.deps.groups.findMemberById(groupId, memberId);
    if (target === null || !isGhost(target)) throw new ResourceNotFound();
    const issued = this.deps.tokens.generate();
    await this.deps.groups.replaceClaimLink({ groupId, memberId, tokenHash: issued.hash });
    return { token: issued.raw };
  }
}
