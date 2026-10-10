import type {
  ClaimLinkResponse,
  GroupCategoryResponse,
  GroupDetailResponse,
  GroupMemberResponse,
  GroupResponse,
  InvitationResponse,
} from '@pesly/shared';
import type { CreatedClaimLink } from '../../application/create-claim-link';
import type { CreatedInvitation } from '../../application/create-invitation';
import type { GroupWithMembers } from '../../application/get-group';
import type { GroupSummary } from '../../domain/group';
import type { GroupCategory } from '../../domain/group-category';
import { isGhost, type Member } from '../../domain/member';

/**
 * The only place where dates become ISO strings. A member never carries an email or a user id: a
 * registered member has a null name and the web shows the user's own (spec D2).
 */
export function presentMember(member: Member): GroupMemberResponse {
  return {
    id: member.id,
    displayName: member.displayName,
    isGhost: isGhost(member),
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
  };
}

export function presentGroup(summary: GroupSummary): GroupResponse {
  return {
    id: summary.group.id,
    name: summary.group.name,
    defaultRateType: summary.group.defaultRateType,
    role: summary.role,
    memberCount: summary.memberCount,
    createdAt: summary.group.createdAt.toISOString(),
  };
}

export function presentGroupDetail(detail: GroupWithMembers): GroupDetailResponse {
  return { ...presentGroup(detail), members: detail.members.map(presentMember) };
}

/** The raw token leaves the API here and only here; the database keeps its hash. */
export function presentInvitation(invitation: CreatedInvitation): InvitationResponse {
  return { token: invitation.token, expiresAt: invitation.expiresAt.toISOString() };
}

export function presentClaimLink(link: CreatedClaimLink): ClaimLinkResponse {
  return { token: link.token };
}

export function presentGroupCategory(category: GroupCategory): GroupCategoryResponse {
  return {
    id: category.id,
    defaultKey: category.defaultKey,
    name: category.name,
    icon: category.icon,
    color: category.color,
    archivedAt: category.archivedAt?.toISOString() ?? null,
  };
}
