import { pushNoticesLink, type PushPayload } from '@pesly/shared';

export type PushNoticeKind =
  | 'reminder'
  | 'recorded'
  | 'not_recorded'
  | 'card_statement_due'
  | 'budget_alert';

export interface RenderPushPayloadInput {
  noticeId: string;
  kind: PushNoticeKind;
  language: 'es' | 'en';
  storedText: string;
  /** `YYYY-MM-DD` */
  dueDate: string;
}

export const PUSH_PAYLOAD_MAX_BYTES = 3000;

const STATEMENT_TEXT = {
  en: (day: string) => `A card statement is due on ${day}`,
  es: (day: string) => `Vence un resumen de tarjeta el ${day}`,
} as const;

/**
 * The text of a push. Stored notice text is already free of amounts and account names; a statement
 * notice stores the card name, so its body is re-rendered from the due day alone.
 */
export function renderPushPayload(input: RenderPushPayloadInput): PushPayload {
  const { noticeId, kind, language, storedText, dueDate } = input;
  if (kind === 'budget_alert') throw new Error('A budget alert is never pushed');

  const body =
    kind === 'card_statement_due'
      ? STATEMENT_TEXT[language](
          new Intl.DateTimeFormat(language, {
            day: 'numeric',
            month: 'short',
            timeZone: 'UTC',
          })
            .format(new Date(`${dueDate}T00:00:00Z`))
            .replace(/\.$/, ''),
        )
      : storedText;

  const payload = { noticeId, title: 'Pesly', body, url: pushNoticesLink(language) };
  if (new TextEncoder().encode(JSON.stringify(payload)).length > PUSH_PAYLOAD_MAX_BYTES) {
    throw new Error('The push payload exceeds the byte limit');
  }
  return payload;
}
