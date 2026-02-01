\set ON_ERROR_STOP on

BEGIN;

-- Fixed principals and users (admin, apprentice, proxy, i18n)
INSERT INTO principal (id, principal_type, display_name, slug)
VALUES
    ('90000000-0000-0000-0000-000000000001'::uuid, 'user', 'Test User', 'testuser'),
    ('29B6C503-11DF-43EC-8CCA-40C7003149CE'::uuid, 'user', 'Apprentice User', 'apprentice'),
    ('90000000-0000-0000-0000-000000000002'::uuid, 'user', 'Proxy User', 'superuser'),
    ('860B3EE9-6D7C-4296-9639-E6B998074A78'::uuid, 'user', 'まだ', 'i18nuser')
ON CONFLICT DO NOTHING;

INSERT INTO "user" (id, name, email, principal_id)
VALUES
    (uuidv7(), 'Test User', 'testuser', '90000000-0000-0000-0000-000000000001'::uuid),
    (uuidv7(), 'Apprentice User', 'apprentice', '29B6C503-11DF-43EC-8CCA-40C7003149CE'::uuid),
    (uuidv7(), 'Proxy User', 'superuser', '90000000-0000-0000-0000-000000000002'::uuid),
    (uuidv7(), 'まだ', 'i18nuser', '860B3EE9-6D7C-4296-9639-E6B998074A78'::uuid)
ON CONFLICT DO NOTHING;

INSERT INTO auth_user (id, user_id, auth_source, auth_id, auth_credential)
SELECT uuidv7(), u.id, 'password', u.email, :'password_hash'
FROM "user" u
WHERE u.principal_id IN (
    '90000000-0000-0000-0000-000000000001'::uuid,
    '29B6C503-11DF-43EC-8CCA-40C7003149CE'::uuid,
    '90000000-0000-0000-0000-000000000002'::uuid,
    '860B3EE9-6D7C-4296-9639-E6B998074A78'::uuid
)
ON CONFLICT DO NOTHING;

-- Standard users (user01-user40)
INSERT INTO principal (id, principal_type, display_name, slug)
SELECT
    ('10000000-0000-0000-0000-000000000' || lpad(i::text, 3, '0'))::uuid,
    'user',
    'User ' || lpad(i::text, 2, '0'),
    'user' || lpad(i::text, 2, '0')
FROM generate_series(1, 40) AS s(i)
ON CONFLICT DO NOTHING;

INSERT INTO "user" (id, name, email, principal_id)
SELECT
    uuidv7(),
    'User ' || lpad(i::text, 2, '0'),
    'user' || lpad(i::text, 2, '0'),
    ('10000000-0000-0000-0000-000000000' || lpad(i::text, 3, '0'))::uuid
FROM generate_series(1, 40) AS s(i)
ON CONFLICT DO NOTHING;

INSERT INTO auth_user (id, user_id, auth_source, auth_id, auth_credential)
SELECT uuidv7(), u.id, 'password', u.email, :'password_hash'
FROM "user" u
WHERE u.principal_id >= '10000000-0000-0000-0000-000000000001'::uuid
  AND u.principal_id <= '10000000-0000-0000-0000-000000000040'::uuid
ON CONFLICT DO NOTHING;

-- Public users (public01-public10)
INSERT INTO principal (id, principal_type, display_name, slug)
SELECT
    ('50000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid,
    'user',
    'Public ' || lpad(i::text, 2, '0'),
    'public' || lpad(i::text, 2, '0')
FROM generate_series(1, 10) AS s(i)
ON CONFLICT DO NOTHING;

INSERT INTO "user" (id, name, email, principal_id)
SELECT
    uuidv7(),
    'Public ' || lpad(i::text, 2, '0'),
    'public' || lpad(i::text, 2, '0'),
    ('50000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid
FROM generate_series(1, 10) AS s(i)
ON CONFLICT DO NOTHING;

INSERT INTO auth_user (id, user_id, auth_source, auth_id, auth_credential)
SELECT uuidv7(), u.id, 'password', u.email, :'password_hash'
FROM "user" u
WHERE u.principal_id >= '50000000-0000-0000-0000-000000000001'::uuid
  AND u.principal_id <= '50000000-0000-0000-0000-000000000010'::uuid
ON CONFLICT DO NOTHING;

-- Resource principals (resource01-resource20)
INSERT INTO principal (id, principal_type, display_name, slug)
SELECT
    ('40000000-0000-0000-0000-000000000' || lpad(i::text, 3, '0'))::uuid,
    'resource',
    'Resource ' || lpad(i::text, 2, '0'),
    'resource' || lpad(i::text, 2, '0')
FROM generate_series(1, 20) AS s(i)
ON CONFLICT DO NOTHING;

-- Location principals (location01-location10)
INSERT INTO principal (id, principal_type, display_name, slug)
SELECT
    ('30000000-0000-0000-0000-000000000' || lpad(i::text, 3, '0'))::uuid,
    'resource',
    'Location ' || lpad(i::text, 2, '0'),
    'location' || lpad(i::text, 2, '0')
FROM generate_series(1, 10) AS s(i)
ON CONFLICT DO NOTHING;

-- Group principals (group01-group40)
INSERT INTO principal (id, principal_type, display_name, slug)
SELECT
    ('20000000-0000-0000-0000-000000000' || lpad(i::text, 3, '0'))::uuid,
    'group',
    'Group ' || lpad(i::text, 2, '0'),
    'group' || lpad(i::text, 2, '0')
FROM generate_series(1, 40) AS s(i)
ON CONFLICT DO NOTHING;

INSERT INTO "group" (id, principal_id)
SELECT
    uuidv7(),
    ('20000000-0000-0000-0000-000000000' || lpad(i::text, 3, '0'))::uuid
FROM generate_series(1, 40) AS s(i)
ON CONFLICT DO NOTHING;

INSERT INTO group_name (id, group_id, name)
SELECT
    uuidv7(),
    g.id,
    'Group ' || lpad(i::text, 2, '0')
FROM generate_series(1, 40) AS s(i)
JOIN "group" g ON g.principal_id = ('20000000-0000-0000-0000-000000000' || lpad(i::text, 3, '0'))::uuid
ON CONFLICT DO NOTHING;

-- Disabled group
INSERT INTO principal (id, principal_type, display_name, slug)
VALUES ('20000000-0000-0000-0000-000000000999'::uuid, 'group', 'Disabled Group', 'disabledgroup')
ON CONFLICT DO NOTHING;

INSERT INTO "group" (id, principal_id)
VALUES (uuidv7(), '20000000-0000-0000-0000-000000000999'::uuid)
ON CONFLICT DO NOTHING;

INSERT INTO group_name (id, group_id, name)
SELECT uuidv7(), g.id, 'Disabled Group'
FROM "group" g
WHERE g.principal_id = '20000000-0000-0000-0000-000000000999'::uuid
ON CONFLICT DO NOTHING;

-- Calendar collections for all user/resource principals
INSERT INTO dav_collection (owner_principal_id, collection_type, display_name, description, timezone_tzid, slug)
SELECT p.id, 'calendar', 'Calendar', NULL, NULL, 'calendar'
FROM principal p
WHERE p.principal_type IN ('user', 'resource')
ON CONFLICT DO NOTHING;

-- Tasks and polls calendars for user principals
INSERT INTO dav_collection (owner_principal_id, collection_type, display_name, description, timezone_tzid, slug)
SELECT p.id, 'calendar', 'Tasks', NULL, NULL, 'tasks'
FROM principal p
WHERE p.principal_type = 'user'
ON CONFLICT DO NOTHING;

INSERT INTO dav_collection (owner_principal_id, collection_type, display_name, description, timezone_tzid, slug)
SELECT p.id, 'calendar', 'Polls', NULL, NULL, 'polls'
FROM principal p
WHERE p.principal_type = 'user'
ON CONFLICT DO NOTHING;

-- Addressbooks for user principals
INSERT INTO dav_collection (owner_principal_id, collection_type, display_name, description, timezone_tzid, slug)
SELECT p.id, 'addressbook', 'Address Book', NULL, NULL, 'addressbook'
FROM principal p
WHERE p.principal_type = 'user'
ON CONFLICT DO NOTHING;

-- Casbin policies: Grant users owner access to their own collections
-- Format: (ptype='p', v0=principal:uuid, v1=path_pattern, v2=role)
-- Path patterns use UUID-based paths like /api/dav/cal/principal-uuid/**
INSERT INTO casbin_rule (ptype, v0, v1, v2, v3, v4, v5)
SELECT 'p', 'principal:' || p.id::text, '/cal/' || p.id::text || '/**', 'owner', '', '', ''
FROM principal p
WHERE p.principal_type IN ('user', 'resource')
ON CONFLICT DO NOTHING;

INSERT INTO casbin_rule (ptype, v0, v1, v2, v3, v4, v5)
SELECT 'p', 'principal:' || p.id::text, '/card/' || p.id::text || '/**', 'owner', '', '', ''
FROM principal p
WHERE p.principal_type = 'user'
ON CONFLICT DO NOTHING;

-- Grant users read access to their own principal resource
INSERT INTO casbin_rule (ptype, v0, v1, v2, v3, v4, v5)
SELECT 'p', 'principal:' || p.id::text, '/principal/' || p.id::text, 'reader', '', '', ''
FROM principal p
WHERE p.principal_type IN ('user', 'resource')
ON CONFLICT DO NOTHING;

COMMIT;

