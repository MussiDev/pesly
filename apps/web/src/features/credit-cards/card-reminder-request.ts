import { cardReminderDaysSchema, type UpdateCreditCardRequest } from '@pesly/shared';

/** The three editable values of a card, as saved or as typed. */
export interface CardSettings {
  closingDay: number;
  dueDay: number;
  reminderDays: number;
}

/**
 * Whole days from 0 to 30 typed in a numeric field, or `null`. An empty text is `null` too: the
 * create form turns it into the default before calling, the edit form shows a field error.
 */
export function parseReminderDays(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const parsed = cardReminderDaysSchema.safeParse(Number.parseInt(trimmed, 10));
  return parsed.success ? parsed.data : null;
}

/**
 * The body of `PATCH /credit-cards/:id`: only the fields that differ from the saved card, or `null`
 * when nothing changed. A reminder-only change never carries the days, so the server does not
 * recompute the open statements (D5).
 */
export function buildCardUpdate(
  saved: CardSettings,
  values: CardSettings,
): UpdateCreditCardRequest | null {
  const body: UpdateCreditCardRequest = {};
  if (values.closingDay !== saved.closingDay) body.closingDay = values.closingDay;
  if (values.dueDay !== saved.dueDay) body.dueDay = values.dueDay;
  if (values.reminderDays !== saved.reminderDays) body.reminderDays = values.reminderDays;
  return Object.keys(body).length > 0 ? body : null;
}
