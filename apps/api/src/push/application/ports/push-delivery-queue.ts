export type PushDeliveryFinalStatus = 'sent' | 'failed' | 'skipped';

/** A claimed delivery with everything needed to build and send its push. */
export interface DueDelivery {
  id: string;
  /** Attempts including the one this claim starts. */
  attempts: number;
  noticeId: string;
  noticeKind: string;
  noticeText: string;
  /** `YYYY-MM-DD` */
  dueDate: string;
  readAt: Date | null;
  noticeCreatedAt: Date;
  noticeOwnerId: string;
  ownerLanguage: 'es' | 'en';
  subscriptionId: string;
  subscriptionOwnerId: string;
  pushUrl: string;
  p256dh: string;
  auth: string;
}

export interface PushDeliveryQueue {
  /** Claims up to `limit` due deliveries with a 120 s lease; a claim never marked becomes due again. */
  claimDue(now: Date, limit: number): Promise<DueDelivery[]>;
  /**
   * Re-reads, right before sending, that the subscription still has this endpoint and belongs to
   * the notice owner, and extends the lease in the same statement. `false` means do not send.
   */
  confirmOwnership(delivery: DueDelivery, now: Date): Promise<boolean>;
  /** Guarded by `status = 'pending'`; resolves `false` when another writer got there first. */
  mark(id: string, status: PushDeliveryFinalStatus, now: Date): Promise<boolean>;
  /** Schedules another attempt and clears the lease; guarded by `status = 'pending'`. */
  reschedule(id: string, nextAttemptAt: Date, now: Date): Promise<boolean>;
  /** Deletes the subscription; its deliveries cascade. */
  deleteSubscription(subscriptionId: string): Promise<void>;
  /** Deletes finished deliveries last updated before `cutoff`. */
  purgeDone(cutoff: Date): Promise<number>;
}
