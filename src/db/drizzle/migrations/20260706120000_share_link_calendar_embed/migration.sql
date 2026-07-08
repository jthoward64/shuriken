-- Opts a share-linked calendar into the public, unauthenticated
-- /embed/<token> calendar widget, independent of the .ics feed itself
-- (see EmbedConfig / share-link/repository.ts). Off by default.
ALTER TABLE "share_link_calendars" ADD COLUMN "embed_enabled" boolean DEFAULT false NOT NULL;
