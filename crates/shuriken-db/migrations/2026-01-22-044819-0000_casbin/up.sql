CREATE TABLE "casbin_rule"(
	"id" INTEGER NOT NULL PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"ptype" VARCHAR NOT NULL,
	"v0" VARCHAR NOT NULL DEFAULT '',
	"v1" VARCHAR NOT NULL DEFAULT '',
	"v2" VARCHAR NOT NULL DEFAULT '',
	"v3" VARCHAR NOT NULL DEFAULT '',
	"v4" VARCHAR NOT NULL DEFAULT '',
	"v5" VARCHAR NOT NULL DEFAULT ''
);

COMMENT ON TABLE "casbin_rule" IS 'Casbin authorization rules table';

CREATE INDEX idx_casbin_rule_ptype ON "casbin_rule"(ptype);
-- We only use v0, v1, v2 for filtering in our policies
CREATE INDEX idx_casbin_rule_v0 ON "casbin_rule"(v0);
CREATE INDEX idx_casbin_rule_v1 ON "casbin_rule"(v1);
CREATE INDEX idx_casbin_rule_v2 ON "casbin_rule"(v2);

INSERT INTO casbin_rule (ptype, v0, v1) VALUES
	('g2', 'reader-freebusy', 'read_freebusy'),
	('g2', 'reader', 'read_freebusy'),
	('g2', 'reader', 'read'),
	('g2', 'editor-basic', 'read_freebusy'),
	('g2', 'editor-basic', 'read'),
	('g2', 'editor-basic', 'edit'),
	('g2', 'editor', 'read_freebusy'),
	('g2', 'editor', 'read'),
	('g2', 'editor', 'edit'),
	('g2', 'editor', 'delete'),
	('g2', 'share-manager', 'read_freebusy'),
	('g2', 'share-manager', 'read'),
	('g2', 'share-manager', 'edit'),
	('g2', 'share-manager', 'delete'),
	('g2', 'share-manager', 'share_read'),
	('g2', 'share-manager', 'share_edit'),
	('g2', 'owner', 'read_freebusy'),
	('g2', 'owner', 'read'),
	('g2', 'owner', 'edit'),
	('g2', 'owner', 'delete'),
	('g2', 'owner', 'share_read'),
	('g2', 'owner', 'share_edit'),
	('g2', 'owner', 'admin')