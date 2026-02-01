CREATE TABLE "casbin_rule"(
	"id" INTEGER NOT NULL PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"ptype" VARCHAR NOT NULL,
	"v0" VARCHAR NOT NULL,
	"v1" VARCHAR NOT NULL,
	"v2" VARCHAR NOT NULL,
	"v3" VARCHAR NOT NULL,
	"v4" VARCHAR NOT NULL,
	"v5" VARCHAR NOT NULL
);

COMMENT ON TABLE "casbin_rule" IS 'Casbin authorization rules table';

CREATE INDEX idx_casbin_rule_ptype ON "casbin_rule"(ptype);
-- We only use v0, v1, v2 for filtering in our policies
CREATE INDEX idx_casbin_rule_v0 ON "casbin_rule"(v0);
CREATE INDEX idx_casbin_rule_v1 ON "casbin_rule"(v1);
CREATE INDEX idx_casbin_rule_v2 ON "casbin_rule"(v2);