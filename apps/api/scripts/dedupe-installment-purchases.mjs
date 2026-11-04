// One-off repair for the statement-import bug fixed in bc6543f: importing the next month's
// statement created a second installment purchase for every purchase still being paid.
//
// Usage (DATABASE_URL points at the target database):
//   node scripts/dedupe-installment-purchases.mjs           # dry run: lists what would go
//   node scripts/dedupe-installment-purchases.mjs --apply   # deletes, in one transaction
//
// Two active purchases are the same purchase when they share owner, card, purchase day,
// currency, installment count, description (case-insensitive) and the period of installment 1,
// and their totals differ by at most the installment count (the bank's one-cent rounding per
// installment). Purchases without a description (made by hand) are never touched.
//
// Genuine identical purchases (two equal lines in one statement) are created by the same import,
// within seconds of each other. So the number to keep is the largest number of copies created in
// one hour; the oldest copies are kept and the rest deleted (their installments cascade).
// Output carries ids, days and counts only: no amounts or descriptions.
import pg from 'pg';

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const HOUR_MS = 60 * 60 * 1000;

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('begin');
  const { rows } = await client.query(`
    select p.id, p.owner_id, p.card_id, p.purchased_on::text as purchased_on, p.currency,
           p.installment_count, lower(btrim(p.note)) as note_key, p.total_amount::text as total,
           p.created_at, i.period as first_period
      from installment_purchases p
      join installments i on i.purchase_id = p.id and i.number = 1
     where p.cancelled_at is null and p.note is not null
     order by p.created_at, p.id
     for update of p`);

  const groups = new Map();
  for (const row of rows) {
    const key = [
      row.owner_id,
      row.card_id,
      row.purchased_on,
      row.currency,
      row.installment_count,
      row.note_key,
      row.first_period,
    ].join('|');
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const toDelete = [];
  let affectedGroups = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Split further by total: copies differ by at most one minor unit per installment.
    const clusters = [];
    for (const row of group) {
      const total = BigInt(row.total);
      const limit = BigInt(row.installment_count);
      const cluster = clusters.find((c) => {
        const diff = BigInt(c[0].total) - total;
        return diff <= limit && diff >= -limit;
      });
      if (cluster) cluster.push(row);
      else clusters.push([row]);
    }
    for (const cluster of clusters) {
      if (cluster.length < 2) continue;
      let keep = 1;
      for (const row of cluster) {
        const start = row.created_at.getTime();
        const sameImport = cluster.filter((other) => {
          const t = other.created_at.getTime();
          return t >= start && t < start + HOUR_MS;
        }).length;
        keep = Math.max(keep, sameImport);
      }
      const extra = cluster.slice(keep);
      if (extra.length === 0) continue;
      affectedGroups += 1;
      console.log(
        `card ${cluster[0].card_id} · bought ${cluster[0].purchased_on} · ${cluster[0].installment_count} installments · ` +
          `${cluster.length} copies, keeping ${keep}: ${cluster
            .slice(0, keep)
            .map((r) => r.id)
            .join(', ')}` +
          ` · deleting ${extra.map((r) => r.id).join(', ')}`,
      );
      toDelete.push(...extra.map((r) => r.id));
    }
  }

  console.log(
    `\n${rows.length} active purchases read, ${affectedGroups} duplicated, ${toDelete.length} to delete.`,
  );
  if (apply && toDelete.length > 0) {
    const { rowCount } = await client.query(
      'delete from installment_purchases where id = any($1::uuid[]) and cancelled_at is null',
      [toDelete],
    );
    if (rowCount !== toDelete.length) {
      throw new Error(`expected to delete ${toDelete.length} purchases, deleted ${rowCount}`);
    }
    await client.query('commit');
    console.log(`Deleted ${rowCount} purchases and their installments.`);
  } else {
    await client.query('rollback');
    if (!apply) console.log('Dry run: nothing changed. Run with --apply to delete.');
  }
} catch (error) {
  await client.query('rollback').catch(() => {});
  throw error;
} finally {
  await client.end();
}
