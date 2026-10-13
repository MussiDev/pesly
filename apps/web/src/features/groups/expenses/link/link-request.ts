import { linkPayerMovementRequestSchema, type LinkPayerMovementRequest } from '@pesly/shared';

export type LinkWay = 'create' | 'adopt';

/** What the person chose on the screen, whichever way is showing. */
export interface LinkValues {
  way: LinkWay;
  accountId: string;
  categoryId: string;
  movementId: string;
}

/** The fields the screen can ask for again; each one is worded by the view. */
export interface LinkFieldErrors {
  account?: true;
  category?: true;
  movement?: true;
}

/** The body for the way that is showing, or the fields to ask for; the shared schema has the last word. */
export function buildLinkRequest(values: LinkValues): {
  request?: LinkPayerMovementRequest;
  fields: LinkFieldErrors;
} {
  const fields: LinkFieldErrors = {};
  if (values.way === 'create') {
    if (values.accountId === '') fields.account = true;
    if (values.categoryId === '') fields.category = true;
  } else if (values.movementId === '') {
    fields.movement = true;
  }
  if (Object.keys(fields).length > 0) return { fields };
  const parsed = linkPayerMovementRequestSchema.safeParse(
    values.way === 'create'
      ? { mode: 'create', accountId: values.accountId, categoryId: values.categoryId }
      : { mode: 'adopt', movementId: values.movementId },
  );
  return parsed.success ? { request: parsed.data, fields } : { fields: { account: true } };
}
