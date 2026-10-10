/** The languages a notice can be written in; the owner's `users.language`. */
export type NoticePublisherLanguage = 'es' | 'en';

export type PublishNoticeKind = 'reminder' | 'recorded' | 'not_recorded';

/**
 * Structured facts about a notice. The adapter renders the text, so recurring never builds user
 * facing wording and cannot leak an amount or an account name into it (NFR-05).
 */
export interface PublishNoticeInput {
  ownerId: string;
  kind: PublishNoticeKind;
  paymentId: string;
  paymentName: string;
  dueDate: string;
  language: NoticePublisherLanguage;
  /** Whole days from today to `dueDate`; required for `reminder`. */
  daysUntilDue?: number;
}

/** System path: it is not scoped by a request, the owner comes from the database. */
export interface NoticePublisher {
  /** `true` when a row was created, `false` when the (kind, payment, due date) already existed. */
  publish(input: PublishNoticeInput): Promise<boolean>;
  /** One multi-row insert; returns how many rows were created. */
  publishMany(inputs: readonly PublishNoticeInput[]): Promise<number>;
}
