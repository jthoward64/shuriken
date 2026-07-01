import { Effect, Option } from "effect";
import type { IrComponent } from "#src/data/ir.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId, EntityId, type InstanceId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	HTTP_FOUND,
	HTTP_NOT_FOUND,
	HTTP_NOT_MODIFIED,
	HTTP_OK,
} from "#src/http/status.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { AclService } from "#src/services/acl/service.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/contacts/<instanceId>/photo
//
// Streams a contact's vCard PHOTO. The list emits <img> only for contacts the
// card_index flagged as has_photo, so this endpoint is hit lazily (and by the
// browser, so it also benefits from HTTP caching).
//
// Caching: the response carries the instance ETag (the vCard's etag — any edit
// rotates it, which safely over-invalidates the photo) and honours
// If-None-Match with a 304. Cache-Control is `private` because photos sit
// behind authentication.
//
// PHOTO may be embedded (`data:` URI) or a remote `http(s)` URL. Embedded
// photos are decoded and streamed inline; remote URLs get a 302 so the browser
// fetches them directly (no server-side proxying / SSRF surface).
// ---------------------------------------------------------------------------

const PHOTO_CACHE_CONTROL = "private, max-age=3600, must-revalidate";

/** Pull the PHOTO property's raw string value out of a parsed vCard. */
const photoValue = (vcard: IrComponent): Option.Option<string> => {
	for (const p of vcard.properties) {
		if (
			p.name === "PHOTO" &&
			(p.value.type === "TEXT" || p.value.type === "URI") &&
			p.value.value !== ""
		) {
			return Option.some(p.value.value);
		}
	}
	return Option.none();
};

/** Normalise an ETag for comparison: drop a weak prefix and surrounding quotes. */
const normalizeEtag = (raw: string): string =>
	raw
		.trim()
		.replace(/^W\//, "")
		.replace(/^"(.*)"$/, "$1");

/** True if `ifNoneMatch` (an If-None-Match header) matches `etag`. */
const etagMatches = (ifNoneMatch: string | null, etag: string): boolean => {
	if (ifNoneMatch === null) {
		return false;
	}
	if (ifNoneMatch.trim() === "*") {
		return true;
	}
	const target = normalizeEtag(etag);
	return ifNoneMatch
		.split(",")
		.some((candidate) => normalizeEtag(candidate) === target);
};

interface DecodedPhoto {
	readonly mime: string;
	// ArrayBuffer-backed (not ArrayBufferLike) so it satisfies Response's BodyInit.
	readonly bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Decode a `data:` URI into its media type and bytes. Returns None for values
 * that aren't a well-formed data URI (e.g. remote URLs, handled separately).
 */
const decodeDataUri = (value: string): Option.Option<DecodedPhoto> => {
	const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(value);
	if (match === null) {
		return Option.none();
	}
	const mime =
		match[1] !== undefined && match[1] !== "" ? match[1] : "image/jpeg";
	const isBase64 = match[2] !== undefined;
	const payload = match[3] ?? "";
	if (isBase64) {
		const binary = atob(payload);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return Option.some({ mime, bytes });
	}
	// Percent-encoded (rare for images) — decode to UTF-8 bytes. Copy into a
	// fresh ArrayBuffer-backed view so it satisfies Response's BodyInit.
	const bytes = new Uint8Array(
		new TextEncoder().encode(decodeURIComponent(payload)),
	);
	return Option.some({ mime, bytes });
};

export const contactsPhotoHandler = (
	req: Request,
	ctx: HttpRequestContext,
	instanceId: InstanceId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | ComponentRepository | InstanceService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const instanceSvc = yield* InstanceService;
		const componentRepo = yield* ComponentRepository;

		const instance = yield* instanceSvc.findById(instanceId);
		yield* acl.check(
			principal.principalId,
			CollectionId(instance.collectionId),
			"collection",
			"DAV:read",
		);

		const etag = `"${normalizeEtag(instance.etag)}"`;

		// Answer conditional requests before touching the component tree — a
		// browser re-request of an unchanged photo costs one instance lookup.
		if (etagMatches(req.headers.get("If-None-Match"), etag)) {
			return new Response(null, {
				status: HTTP_NOT_MODIFIED,
				headers: { ETag: etag, "Cache-Control": PHOTO_CACHE_CONTROL },
			});
		}

		const tree = yield* componentRepo.loadTree(
			EntityId(instance.entityId),
			"vcard",
		);
		const photo = Option.flatMap(tree, (root) =>
			root.name === "VCARD" ? photoValue(root) : Option.none(),
		);

		if (Option.isNone(photo)) {
			return new Response(null, { status: HTTP_NOT_FOUND });
		}
		const value = photo.value;

		// Remote URL: redirect the browser to fetch it directly.
		if (/^https?:\/\//i.test(value)) {
			return new Response(null, {
				status: HTTP_FOUND,
				headers: {
					Location: value,
					"Cache-Control": PHOTO_CACHE_CONTROL,
					ETag: etag,
				},
			});
		}

		const decoded = decodeDataUri(value);
		if (Option.isNone(decoded)) {
			return new Response(null, { status: HTTP_NOT_FOUND });
		}
		const { mime, bytes } = decoded.value;
		return new Response(bytes, {
			status: HTTP_OK,
			headers: {
				"Content-Type": mime,
				"Content-Length": String(bytes.byteLength),
				"Content-Disposition": "inline",
				"Cache-Control": PHOTO_CACHE_CONTROL,
				ETag: etag,
			},
		});
	});
