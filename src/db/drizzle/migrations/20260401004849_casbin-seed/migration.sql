-- Custom SQL migration file, put your code below! --

-- g2: privilege containment hierarchy (leaf → aggregate, static)
-- Allows a policy granting an aggregate to satisfy a request for a leaf.
INSERT INTO "casbin_rule" (ptype, v0, v1) VALUES
    -- DAV:write aggregates its four sub-privileges
    ('g2', 'DAV:write-properties',              'DAV:write'),
    ('g2', 'DAV:write-content',                 'DAV:write'),
    ('g2', 'DAV:bind',                          'DAV:write'),
    ('g2', 'DAV:unbind',                        'DAV:write'),
    -- DAV:all aggregates everything
    ('g2', 'DAV:read',                          'DAV:all'),
    ('g2', 'DAV:write',                         'DAV:all'),
    ('g2', 'DAV:write-properties',              'DAV:all'),
    ('g2', 'DAV:write-content',                 'DAV:all'),
    ('g2', 'DAV:bind',                          'DAV:all'),
    ('g2', 'DAV:unbind',                        'DAV:all'),
    ('g2', 'DAV:unlock',                        'DAV:all'),
    ('g2', 'DAV:read-acl',                      'DAV:all'),
    ('g2', 'DAV:read-current-user-privilege-set','DAV:all'),
    ('g2', 'DAV:write-acl',                     'DAV:all');
--> statement-breakpoint

-- g: pseudo-principal hierarchy (static)
-- DAV:authenticated and DAV:unauthenticated both inherit DAV:all,
-- so any principal that the application assigns to either pseudo-principal
-- will transitively match DAV:all policies.
INSERT INTO "casbin_rule" (ptype, v0, v1) VALUES
    ('g', 'DAV:authenticated',   'DAV:all'),
    ('g', 'DAV:unauthenticated', 'DAV:all');