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
INSERT INTO "casbin_rule" (ptype, v0, v1) VALUES
    ('g', 'DAV:authenticated',   'DAV:all'),
    ('g', 'DAV:unauthenticated', 'DAV:all');