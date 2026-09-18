// Test-only structural doubles.
//
// Some service shapes are third-party types too large to build faithfully in a
// unit test (Drizzle's `DbClient` is the main one). `asDouble` is the single
// place that admits the structural assertion, so the intent is explicit and the
// assertion does not spread through the test suite.

/** Presents a partial structural stub as the full service type */
export const asDouble = <T>(shape: unknown): T => shape as T;
