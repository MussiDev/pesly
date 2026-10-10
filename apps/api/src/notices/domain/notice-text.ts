import type { NoticeKind } from './notice';

export type NoticeLanguage = 'es' | 'en';

export const NOTICE_NAME_MAX_LENGTH = 80;

export interface NoticeTextInput {
  kind: NoticeKind;
  language: NoticeLanguage;
  paymentName: string;
  dueDate: string;
  daysUntilDue?: number;
}

function formatDay(dueDate: string, language: NoticeLanguage): string {
  return new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${dueDate}T00:00:00Z`));
}

function reminderText(name: string, language: NoticeLanguage, days: number): string {
  if (language === 'es') {
    if (days === 0) return `${name} vence hoy`;
    if (days === 1) return `${name} vence mañana`;
    return `${name} vence en ${days} días`;
  }
  if (days === 0) return `${name} is due today`;
  if (days === 1) return `${name} is due tomorrow`;
  return `${name} is due in ${days} days`;
}

/**
 * Pure and amount-free on purpose: it receives no amount and no account name, so none can reach
 * the stored text (NFR-05).
 */
export function renderNoticeText(input: NoticeTextInput): string {
  const name = Array.from(input.paymentName).slice(0, NOTICE_NAME_MAX_LENGTH).join('');
  const { language } = input;
  if (input.kind === 'reminder') {
    if (input.daysUntilDue === undefined) throw new Error('A reminder needs daysUntilDue');
    return reminderText(name, language, input.daysUntilDue);
  }
  const day = formatDay(input.dueDate, language);
  if (input.kind === 'recorded') {
    return language === 'es' ? `Se registró ${name} del ${day}` : `${name} of ${day} was recorded`;
  }
  return language === 'es'
    ? `No se pudo registrar ${name} del ${day}. Está pendiente de tu confirmación.`
    : `${name} of ${day} could not be recorded. It is waiting for your confirmation.`;
}
