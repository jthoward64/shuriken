import { Brand } from "effect";
import "temporal-polyfill/global";

export type UuidString = `${string}-${string}-${string}-${string}-${string}`;

// ---------------------------------------------------------------------------
// Branded UUID types
// ---------------------------------------------------------------------------

export type PrincipalId = UuidString & Brand.Brand<"PrincipalId">;
export type UserId = UuidString & Brand.Brand<"UserId">;
export type GroupId = UuidString & Brand.Brand<"GroupId">;
export type AuthUserId = UuidString & Brand.Brand<"AuthUserId">;
export type GroupNameId = UuidString & Brand.Brand<"GroupNameId">;
export type CollectionId = UuidString & Brand.Brand<"CollectionId">;
export type InstanceId = UuidString & Brand.Brand<"InstanceId">;
export type EntityId = UuidString & Brand.Brand<"EntityId">;
export type ComponentId = UuidString & Brand.Brand<"ComponentId">;
export type PropertyId = UuidString & Brand.Brand<"PropertyId">;
export type VirtualResourceId = UuidString & Brand.Brand<"VirtualResourceId">;
export type RequestId = string & Brand.Brand<"RequestId">;

export const PrincipalId = Brand.nominal<PrincipalId>();
export const UserId = Brand.nominal<UserId>();
export const GroupId = Brand.nominal<GroupId>();
export const AuthUserId = Brand.nominal<AuthUserId>();
export const GroupNameId = Brand.nominal<GroupNameId>();
export const CollectionId = Brand.nominal<CollectionId>();
export const InstanceId = Brand.nominal<InstanceId>();
export const EntityId = Brand.nominal<EntityId>();
export const ComponentId = Brand.nominal<ComponentId>();
export const PropertyId = Brand.nominal<PropertyId>();
export const VirtualResourceId = Brand.nominal<VirtualResourceId>();
export const RequestId = Brand.nominal<RequestId>();

// ---------------------------------------------------------------------------
// UUIDv7 utilities
// ---------------------------------------------------------------------------

// UUIDv7 timestamp prefix length: first 48 bits = 12 hex chars
const UUIDV7_TIMESTAMP_HEX_LENGTH = 12;

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns true if the string is a valid UUID (any version, case-insensitive). */
export const isUuid = (s: string): s is UuidString => UUID_RE.test(s);

/**
 * Extract the creation timestamp from a UUIDv7.
 *
 * UUIDv7 layout: tttttttt-tttt-7xxx-xxxx-xxxxxxxxxxxx
 * The first 48 bits (12 hex chars) encode milliseconds since the Unix epoch.
 */
export const extractInstantFromUuidV7 = (id: UuidString): Temporal.Instant => {
	const hex = id.replaceAll("-", "").slice(0, UUIDV7_TIMESTAMP_HEX_LENGTH);
	return Temporal.Instant.fromEpochMilliseconds(Number.parseInt(hex, 16));
};
