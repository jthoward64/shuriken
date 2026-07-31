// ---------------------------------------------------------------------------
// Where a contact's avatar is fetched from.
//
// A PHOTO is either a remote URL or an embedded `data:` URI holding up to
// half a megabyte of base64. Inlining the latter into every page that shows the
// contact would put that payload in the HTML itself — uncacheable, unlazyable,
// and repeated per render. `GET /ui/contacts/:id/photo` streams it instead,
// with an ETag and lazy loading, so the markup carries only a URL.
//
// Remote URLs are used as-is: the endpoint would only redirect to them.
// ---------------------------------------------------------------------------

/** True when the PHOTO value carries the image itself rather than a link. */
export const isInlinePhoto = (photo: string): boolean =>
	photo.startsWith("data:");

/** The streaming endpoint for a contact's embedded photo. */
export const photoEndpoint = (instanceId: string): string =>
	`/ui/contacts/${instanceId}/photo`;

/**
 * The `src` for a contact's avatar, or "" when there is nothing to show.
 * An embedded photo needs an instance to stream from, so an unsaved contact
 * (no instance yet) has no source for one.
 */
export const photoSrcFor = (
	photo: string,
	instanceId: string | undefined,
): string => {
	if (photo === "") {
		return "";
	}
	if (!isInlinePhoto(photo)) {
		return photo;
	}
	return instanceId === undefined ? "" : photoEndpoint(instanceId);
};
