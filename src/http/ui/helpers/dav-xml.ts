import { buildXml } from "#src/http/dav/xml/builder.ts";
import type { Effect } from "effect";

// ---------------------------------------------------------------------------
// DAV XML body builders — used by UI API handlers that delegate to davRouter
// ---------------------------------------------------------------------------

export const buildProppatchXml = (props: {
	displayName?: string;
}): Effect.Effect<string, never> => {
	const set: Record<string, unknown> = {};
	if (props.displayName !== undefined) {
		set["D:displayname"] = props.displayName;
	}
	return buildXml({
		"D:propertyupdate": {
			"@_xmlns:D": "DAV:",
			"D:set": {
				"D:prop": set,
			},
		},
	});
};
