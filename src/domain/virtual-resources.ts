import type { VirtualResourceId } from "#src/domain/ids.ts";
import { VirtualResourceId as makeVirtualResourceId } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// Well-known virtual resource UUIDs
//
// These UUIDs serve as stable resource identifiers for the admin API
// collections (/dav/users/ and /dav/groups/). They are constants — never
// stored in any entity table, only in dav_acl rows. Granting a privilege on
// one of these virtual resources governs access to that entire collection and
// all per-resource OR-checks in the admin API handlers.
//
// These UUIDs must never change once deployed.
// ---------------------------------------------------------------------------

export const USERS_VIRTUAL_RESOURCE_ID: VirtualResourceId =
	makeVirtualResourceId("00000000-0000-4000-8001-000000000001");

export const GROUPS_VIRTUAL_RESOURCE_ID: VirtualResourceId =
	makeVirtualResourceId("00000000-0000-4000-8001-000000000002");

// ---------------------------------------------------------------------------
// Custom XML namespace for admin API properties
// ---------------------------------------------------------------------------

export const SHURIKEN_NS = "https://shuriken.jthoward.dev/dav/ns";
