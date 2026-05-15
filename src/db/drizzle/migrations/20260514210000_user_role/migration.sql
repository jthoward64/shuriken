-- ---------------------------------------------------------------------------
-- user.role — free-form role tag for the three-tier authorization model
-- (normal / admin / super_admin). Text so future roles can be added without
-- a migration; the policy mapping lives in src/services/role/policy.ts.
--
-- Backfill: any user that already holds DAV:all on the USERS_VIRTUAL_RESOURCE
-- (the previous "admin" marker) is promoted to super_admin so existing
-- deployments don't lose access. Other users default to normal.
-- ---------------------------------------------------------------------------

ALTER TABLE "user" ADD COLUMN "role" text NOT NULL DEFAULT 'normal';
--> statement-breakpoint

UPDATE "user" u
SET role = 'super_admin'
WHERE EXISTS (
    SELECT 1
    FROM dav_acl a
    WHERE a.principal_type = 'principal'
      AND a.principal_id = u.principal_id
      AND a.privilege = 'DAV:all'
      AND a.grant_deny = 'grant'
      AND a.resource_type = 'virtual'
);
