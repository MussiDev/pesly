/** Where one browser subscription can be reached; keys are base64url as the browser gives them. */
export interface PushTarget {
  pushUrl: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  target: PushTarget;
  body: Uint8Array;
  ttlSeconds: number;
  /** Replaces an earlier undelivered push with the same topic (the notice id without hyphens). */
  topic: string;
  urgency: 'normal';
}

/** Closed set of results; a provider never throws for an HTTP or network outcome. */
export type PushOutcome =
  | { kind: 'accepted' }
  | { kind: 'gone' }
  | { kind: 'rejected'; status: number | null }
  | { kind: 'retry'; status: number | null; retryAfterSeconds: number | null };

export interface PushProvider {
  send(message: PushMessage): Promise<PushOutcome>;
}
