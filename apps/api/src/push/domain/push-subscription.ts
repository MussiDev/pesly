/** What the owner's browser gave us; the endpoint is secret-like and never logged. */
export interface PushSubscription {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface NewPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}
