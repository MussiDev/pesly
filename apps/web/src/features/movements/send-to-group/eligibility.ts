import type { MovementGroupLink, MovementResponse } from '@pesly/shared';

export interface SendToGroupOffer {
  movement: Pick<MovementResponse, 'type'>;
  /** The group link the server answered for the movement; `null` when it is not linked. */
  groupExpense: MovementGroupLink | null;
  /** The device holds a queued change of this movement the server does not have yet. */
  queued: boolean;
  online: boolean;
  /** The row exists only on the device (a queued create); the server cannot adopt it. */
  deviceCopy?: boolean;
}

/** Whether the "Send to group" action is offered: online, a server-held, unlinked expense only. */
export function canOfferSendToGroup(offer: SendToGroupOffer): boolean {
  return (
    offer.online &&
    offer.movement.type === 'expense' &&
    !offer.queued &&
    offer.deviceCopy !== true &&
    offer.groupExpense === null
  );
}
