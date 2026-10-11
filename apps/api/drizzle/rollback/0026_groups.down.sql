-- Reverse of 0026_groups.sql. Drops the five group tables, so every stored group, member,
-- invitation, claim link and group category is lost; nothing else is touched.
-- Rollback plan: take a backup first, stop the API and the worker, run this script as a whole
-- (psql -1 -f), then revert the commit that added the migration. Apply it BEFORE the rollback of
-- 0025 (newest `when` first).

DROP TABLE IF EXISTS "group_categories";
DROP TABLE IF EXISTS "group_claim_links";
DROP TABLE IF EXISTS "group_invitations";
DROP TABLE IF EXISTS "group_members";
DROP TABLE IF EXISTS "groups";

-- Forget the migration so `pnpm db:migrate` applies it again; `created_at` is the journal's
-- `when` for 0026_groups.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791661150964;
