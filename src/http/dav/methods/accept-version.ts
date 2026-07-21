import type { VCardVersion } from "./report/address-data.ts";

// ---------------------------------------------------------------------------
// Accept-header vCard version negotiation.
//
// A client may request a specific serialization with a media-range parameter,
// e.g. `Accept: text/vcard; version=3.0`. Returns the requested version when a
// `text/vcard` range carries a supported `version=` param, else undefined
// (server default, 4.0).
// ---------------------------------------------------------------------------

const stripQuotes = (s: string): string => s.replace(/^["']|["']$/g, "");

export const parseAcceptVCardVersion = (
	accept: string | null,
): VCardVersion | undefined => {
	if (accept === null) {
		return undefined;
	}
	for (const range of accept.split(",")) {
		const segs = range.split(";").map((s) => s.trim());
		if (segs[0]?.toLowerCase() !== "text/vcard") {
			continue;
		}
		for (const seg of segs.slice(1)) {
			const eq = seg.indexOf("=");
			if (eq === -1 || seg.slice(0, eq).trim().toLowerCase() !== "version") {
				continue;
			}
			const value = stripQuotes(seg.slice(eq + 1).trim());
			if (value === "3.0" || value === "4.0") {
				return value;
			}
		}
	}
	return undefined;
};
