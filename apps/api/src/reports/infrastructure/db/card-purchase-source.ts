import { databaseTimeZone } from '@pesly/shared';
import { sql } from 'drizzle-orm';
import {
  accounts,
  categories,
  creditCardStatements,
  creditCards,
  movements,
} from './foreign-relations';

/**
 * The FROM of a card purchase read (DISC-001-10b) and the statement each purchase belongs to, shared
 * by the grouped flows and the category detail so both place a purchase in the same month.
 */
export function cardPurchaseSource(timeZone: string) {
  const zone = databaseTimeZone(timeZone);
  // The purchase's calendar day in the user's zone, as the statements' closing dates are days.
  const day = sql`(${movements.occurredAt} at time zone ${zone})::date`;
  // No stored statement closes on or after the day: the cycle the card days would give, and never
  // one at or before the last stored statement (its closing date, possibly edited by hand, is
  // before the day, so the purchase belongs to a later cycle).
  const dayCycle = sql`to_char(case when extract(day from ${day}) <= ${creditCards.closingDay} then ${day} else ${day} + interval '1 month' end, 'YYYY-MM')`;
  const afterLastStored = sql`(
    select to_char((max(${creditCardStatements.period}) || '-01')::date + interval '1 month', 'YYYY-MM')
    from ${creditCardStatements}
    where ${creditCardStatements.cardId} = ${creditCards.id}
      and ${creditCardStatements.ownerId} = ${creditCards.ownerId}
  )`;
  // No purchase date bound: the period is what places a purchase, and a purchase long before the
  // first stored cycle still belongs to that cycle, so a date window would make the figure of a
  // month depend on the range that is asked for.
  return {
    day: sql`to_char(${day}, 'YYYY-MM-DD')`,
    period: sql`coalesce(stmt.period, greatest(${dayCycle}, ${afterLastStored}))`,
    dueDate: sql`to_char(stmt.due_date, 'YYYY-MM-DD')`,
    from: sql`${movements}
        inner join ${accounts}
          on ${accounts.id} = ${movements.accountId} and ${accounts.ownerId} = ${movements.ownerId}
        inner join ${creditCards}
          on ${creditCards.ownerId} = ${movements.ownerId}
          and (${creditCards.arsAccountId} = ${movements.accountId}
            or ${creditCards.usdAccountId} = ${movements.accountId})
        inner join ${categories}
          on ${categories.id} = ${movements.categoryId} and ${categories.ownerId} = ${movements.ownerId}
        left join lateral (
          select ${creditCardStatements.period} as period, ${creditCardStatements.dueDate} as due_date
          from ${creditCardStatements}
          where ${creditCardStatements.cardId} = ${creditCards.id}
            and ${creditCardStatements.ownerId} = ${creditCards.ownerId}
            and ${creditCardStatements.closingDate} >= ${day}
          order by ${creditCardStatements.closingDate} asc, ${creditCardStatements.period} asc
          limit 1
        ) stmt on true`,
  };
}
