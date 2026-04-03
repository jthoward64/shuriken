/** biome-ignore-all lint/style/noMagicNumbers: Wrapper values */

import { Brand } from "effect";

// ---------------------------------------------------------------------------
// HttpStatus — branded number so status codes can't be confused with plain ints
// ---------------------------------------------------------------------------

export type HttpStatus = number & Brand.Brand<"HttpStatus">;
export const HttpStatus = Brand.nominal<HttpStatus>();

export const HTTP_OK = HttpStatus(200);
export const HTTP_MOVED_PERMANENTLY = HttpStatus(301);
export const HTTP_BAD_REQUEST = HttpStatus(400);
export const HTTP_UNAUTHORIZED = HttpStatus(401);
export const HTTP_FORBIDDEN = HttpStatus(403);
export const HTTP_NOT_FOUND = HttpStatus(404);
export const HTTP_METHOD_NOT_ALLOWED = HttpStatus(405);
export const HTTP_CONFLICT = HttpStatus(409);
export const HTTP_INTERNAL_SERVER_ERROR = HttpStatus(500);
export const HTTP_NOT_IMPLEMENTED = HttpStatus(501);
