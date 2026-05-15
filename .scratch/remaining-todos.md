# Remaining TODO work — scratch tracker

Plan source: `/home/tagho/.claude/plans/i-d-like-to-remove-floofy-octopus.md`
Work atomically — finish each box before moving on. Check off when done.

---

## Feature 1: Public tokenized iCal feed (`/feed/<token>.ics`)

- [x] Schema: `share_link.token` (UNIQUE NOT NULL) + `share_link.display_name` columns
- [x] Migration `20260515000000_share_link_token` (portable backfill, no pgcrypto)
- [x] Repository interface: `findByToken`, `setCalendarVisibility`, `token`/`displayName` in insert/update
- [x] Repository .live.ts: findByToken, insert/update accept token+displayName, setCalendarVisibility, all wired into Layer
- [x] Token generator helper (`src/services/share-link/token.ts`): 32-char URL-safe random via `crypto.getRandomValues`
- [x] Service `src/services/share-link/service.ts` (interface only — see file for tag + shape)
- [x] Service `src/services/share-link/service.live.ts`: implement using ShareLinkRepository + AclService. Each mutation: load link, verify caller owns it (link.userId === caller's userId OR DAV:all admin); create/addCalendar additionally check DAV:read on each referenced calendarId. getActiveByToken filters `enabled && (expiresAt == null || expiresAt > now)`.
- [x] Feed renderer `src/services/feed/render.ts`: per-calendar visibility, dedupe VTIMEZONEs, `free_busy` strips SUMMARY/DESCRIPTION/LOCATION/ATTENDEE → `SUMMARY:Busy`
- [x] HTTP handler `src/http/feed/handler.ts`: `GET /feed/<token>.ics` — 200 text/calendar, 404 on disabled/expired/unknown
- [x] Wire `/feed/` route in `src/http/router.ts` (before auth)
- [x] Wire `ShareLinkRepositoryLive` + `ShareLinkServiceLive` in `src/layers.ts`
- [ ] UI handlers: `src/http/ui/handlers/feeds/{list,new,edit}.ts`
- [ ] UI templates: `src/http/ui/templates/pages/feeds/{list,new,edit}.hbs`
- [ ] UI API: `src/http/ui/api/feeds/{create,update,delete,regenerate}.ts`
- [ ] Mount `/ui/feeds` in `src/http/ui/router.ts` + nav link in `nav.hbs`
- [ ] Unit test: render free_busy stripping; multi-calendar feed
- [ ] Integration test: create → curl token URL → 200; flip visibility; disable → 404; past expires → 404

## Feature 2: Bulk import (.ics / .vcf)

- [ ] `src/services/cal-edit/import-ics.ts`: parse via decodeICalendar; modes `error` (conflicts → list of UIDs, no writes), `skip`, `merge` (upsert by UID)
- [ ] `src/services/card-edit/import-vcf.ts`: split on BEGIN:VCARD/END:VCARD then decodeVCard per chunk; same 3 modes
- [ ] UI handler `src/http/ui/handlers/calendar/import.ts` + form template + collision retry partial
- [ ] UI handler `src/http/ui/handlers/contacts/import.ts` + form template
- [ ] UI API `src/http/ui/api/calendar/import.ts` (handles multipart upload, dispatches mode)
- [ ] UI API `src/http/ui/api/contacts/import.ts`
- [ ] Mount routes in `src/http/ui/router.ts`
- [ ] Buttons on calendar viewer + contacts list
- [ ] Unit tests for all 3 modes (ics + vcf)
- [ ] Integration: upload → re-upload error → 409; skip → 0 inserted; merge → in-place update

## Feature 3: Bulk export (.ics / .vcf)

- [ ] `src/services/cal-edit/export-ics.ts`: iterate InstanceRepository, collect VEVENTs, dedupe VTIMEZONEs, encode one VCALENDAR
- [ ] `src/services/card-edit/export-vcf.ts`: iterate, encode each VCARD, concatenate
- [ ] Handler `GET /ui/calendar/<collectionId>/export.ics` with `Content-Disposition: attachment`
- [ ] Handler `GET /ui/contacts/export.vcf?addressbook=<id>`
- [ ] ACL guard: DAV:read on collection
- [ ] Buttons on existing list pages
- [ ] Integration: import → export → semantic-diff round-trip

## Feature 4: Transient SMTP creds from proxy headers

- [x] `src/http/smtp-headers-ref.ts`: `FiberRef<Option<{host?,port?,username,password,security?}>>`
- [x] Config additions in `src/config.ts` under `mail`
- [x] Wire in `src/http/router.ts` post-auth
- [x] `src/services/email-credential/service.live.ts` `resolveForUser`: read FiberRef first; new `ResolvedKind` variant `"user-proxy"`
- [ ] Unit: resolver picks proxy headers over stored creds
- [ ] Integration: iMIP request with headers → mock SMTP gets request-scoped creds

## Feature 5a: Proxy auto-provisioning

- [ ] Config: `auth.proxyAutoProvision: boolean` (default false) in `src/config.ts`
- [ ] Extend `authenticateProxy` in `src/auth/layers/proxy.ts`: take `ProvisioningService`, on user-not-found + autoProvision → validate email, read role from `auth.proxyRoleHeader`, derive slug from local part, call `provisioningSvc.provisionUser`
- [ ] Thread `ProvisioningService` through `CompositeAuthLayer` in `src/auth/layers/composite.ts`
- [ ] Integration: PROXY_AUTO_PROVISION=true + trusted X-Remote-User new email + X-User-Role admin → user created with admin role; second request finds existing user

## Feature 5b: Group-admin editable list

- [ ] `src/http/ui/helpers/acl-panel.ts`: `buildGroupAdminsData` — surface ACEs (resource_type=principal, resource_id=group_principal_id, privilege=DAV:all) joined to principal/user rows
- [ ] `src/http/ui/handlers/groups/edit.ts`: fetch admin list, pass to template
- [ ] `src/http/ui/templates/pages/groups/edit.hbs`: "Group admins" section — list + "Add admin" form + per-row Remove (posts to existing aclGrantHandler/aclRevokeHandler)
- [ ] Integration: alice adds bob → bob's PROPFIND on `/dav/principals/team/` returns 207

---

## Cross-cutting wiring (touch once per feature lands)

- `src/layers.ts`: register new services
- `src/http/ui/router.ts`: `UiServices` union additions per feature
- TODO.md: trim each line as features complete

## Verification (run at end)

```
bun run check && bun run lint && bun test
```

Then manual curl flows from plan §Verification.
