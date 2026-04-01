import { Brand } from "effect";

// ---------------------------------------------------------------------------
// Email — branded email address string
// ---------------------------------------------------------------------------

export type Email = string & Brand.Brand<"Email">;
export const Email = Brand.nominal<Email>();

// ---------------------------------------------------------------------------
// ETag — HTTP entity tag for DAV instances
// ---------------------------------------------------------------------------

export type ETag = string & Brand.Brand<"ETag">;
export const ETag = Brand.nominal<ETag>();
