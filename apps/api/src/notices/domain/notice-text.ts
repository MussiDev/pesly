import type { NoticeKind } from './notice';

export type NoticeLanguage = 'es' | 'en';

export const NOTICE_NAME_MAX_LENGTH = 80;

export interface NoticeTextInput {
  kind: NoticeKind;
  language: NoticeLanguage;
  /** The recurring payment name, the credit card name for `card_statement_due`, the group name for the group kinds. */
  subjectName: string;
  dueDate: string;
  daysUntilDue?: number;
  /** The budget threshold percent (1 to 200), required for `budget_alert`. */
  threshold?: number;
  /** Who recorded the group expense or settlement; null when that member has no display name. */
  actorName?: string | null;
}

const MAX_ALERT_THRESHOLD = 200;

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

const truncateName = (name: string): string =>
  Array.from(name).slice(0, NOTICE_NAME_MAX_LENGTH).join('');

export interface GroupNoticeTextInput {
  kind: 'group_expense' | 'group_settlement';
  language: NoticeLanguage;
  groupName: string;
  /** Who recorded it; null when that member has no display name. */
  actorName: string | null;
}

/** Takes no amount and no description, so neither can reach the stored text (NFR-05). */
export function renderGroupNoticeText(input: GroupNoticeTextInput): string {
  const { kind, language } = input;
  const group = truncateName(input.groupName);
  const actor = input.actorName ? truncateName(input.actorName) : null;
  if (language === 'es') {
    const who = actor ?? 'Un integrante';
    return kind === 'group_expense'
      ? `${who} agregó un gasto en ${group}`
      : `${who} registró un pago en ${group}`;
  }
  const who = actor ?? 'A member';
  return kind === 'group_expense'
    ? `${who} added an expense in ${group}`
    : `${who} recorded a payment in ${group}`;
}

/**
 * Pure and amount-free on purpose: it receives no amount and no account name, so none can reach
 * the stored text (NFR-05).
 */
export function renderNoticeText(input: NoticeTextInput): string {
  const name = truncateName(input.subjectName);
  const { language } = input;
  if (input.kind === 'group_expense' || input.kind === 'group_settlement') {
    return renderGroupNoticeText({
      kind: input.kind,
      language,
      groupName: input.subjectName,
      actorName: input.actorName ?? null,
    });
  }
  if (input.kind === 'reminder') {
    if (input.daysUntilDue === undefined) throw new Error('A reminder needs daysUntilDue');
    return reminderText(name, language, input.daysUntilDue);
  }
  if (input.kind === 'budget_alert') {
    const { threshold } = input;
    if (
      threshold === undefined ||
      !Number.isInteger(threshold) ||
      threshold < 1 ||
      threshold > MAX_ALERT_THRESHOLD
    ) {
      throw new Error('A budget alert needs an integer threshold from 1 to 200');
    }
    return language === 'es'
      ? `${name} alcanzó el ${String(threshold)}% de su presupuesto`
      : `${name} reached ${String(threshold)}% of its budget`;
  }
  const day = formatDay(input.dueDate, language);
  if (input.kind === 'card_statement_due') {
    return language === 'es'
      ? `El resumen de ${name} vence el ${day}`
      : `The ${name} statement is due on ${day}`;
  }
  if (input.kind === 'recorded') {
    return language === 'es' ? `Se registró ${name} del ${day}` : `${name} of ${day} was recorded`;
  }
  return language === 'es'
    ? `No se pudo registrar ${name} del ${day}. Está pendiente de tu confirmación.`
    : `${name} of ${day} could not be recorded. It is waiting for your confirmation.`;
}
