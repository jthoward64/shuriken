import { Brand } from "effect";
import "temporal-polyfill/global";

// ---------------------------------------------------------------------------
// Branded UUID types
// ---------------------------------------------------------------------------

export type PrincipalId = string & Brand.Brand<"PrincipalId">;
export type UserId = string & Brand.Brand<"UserId">;
export type GroupId = string & Brand.Brand<"GroupId">;
export type CollectionId = string & Brand.Brand<"CollectionId">;
export type InstanceId = string & Brand.Brand<"InstanceId">;
export type EntityId = string & Brand.Brand<"EntityId">;
export type ComponentId = string & Brand.Brand<"ComponentId">;
export type PropertyId = string & Brand.Brand<"PropertyId">;
export type RequestId = string & Brand.Brand<"RequestId">;

export const PrincipalId = Brand.nominal<PrincipalId>();
export const UserId = Brand.nominal<UserId>();
export const GroupId = Brand.nominal<GroupId>();
export const CollectionId = Brand.nominal<CollectionId>();
export const InstanceId = Brand.nominal<InstanceId>();
export const EntityId = Brand.nominal<EntityId>();
export const ComponentId = Brand.nominal<ComponentId>();
export const PropertyId = Brand.nominal<PropertyId>();
export const RequestId = Brand.nominal<RequestId>();

// ---------------------------------------------------------------------------
// UUIDv7 utilities
// ---------------------------------------------------------------------------

/**
 * Extract the creation timestamp from a UUIDv7.
 *
 * UUIDv7 layout: tttttttt-tttt-7xxx-xxxx-xxxxxxxxxxxx
 * The first 48 bits (12 hex chars) encode milliseconds since the Unix epoch.
 */
export const extractInstantFromUuidV7 = (id: string): Temporal.Instant => {
	const hex = id.replaceAll("-", "").slice(0, 12);
	return Temporal.Instant.fromEpochMilliseconds(Number.parseInt(hex, 16));
};
