// biome-ignore-all lint/performance/noBarrelFile: the @ts-types directive must stay attached to this one re-export
// Typed re-export of sanitize-html.
//
// The package ships no types of its own, so the import needs a `@ts-types`
// directive naming the DefinitelyTyped package. Keeping it as this module's
// only statement means import sorting cannot separate the directive from the
// import it annotates, which silently drops the types.

// @ts-types="npm:@types/sanitize-html@^2.13.0"
export { default as sanitizeHtml } from "sanitize-html";
