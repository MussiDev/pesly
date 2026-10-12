import type { PushMessage, PushOutcome, PushProvider } from '../../application/ports/push-provider';

/** Test double: records every message, opens no connection. */
export class FakePushProvider implements PushProvider {
  readonly sent: PushMessage[] = [];
  /** Artificial latency applied before each answer. */
  delayMs = 0;
  private readonly scripted = new Map<string, PushOutcome[]>();

  /** Outcomes consumed in order for one push URL; afterwards the device gets `accepted`. */
  script(pushUrl: string, outcomes: PushOutcome[]): void {
    this.scripted.set(pushUrl, [...outcomes]);
  }

  async send(message: PushMessage): Promise<PushOutcome> {
    this.sent.push(message);
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    return this.scripted.get(message.target.pushUrl)?.shift() ?? { kind: 'accepted' };
  }
}
