# 7. Synchronization

## 7.1 WebDAV Sync (RFC 6578)

**Implementation Path**: Use `synctoken` and `sync_revision` columns.

**Requirements (RFC 6578)**:
- If you implement `DAV:sync-collection`, you MUST list it in `DAV:supported-report-set` on any collection that supports synchronization.
- `DAV:sync-token` values MUST be valid URIs (clients treat them as opaque strings, but servers must make them URI-shaped so they can be used in `If`).
- `sync-collection` is only defined for `Depth: 0` (missing Depth defaults to `0` per RFC 3253); any other Depth MUST fail with `400 Bad Request`.

### 7.1.0 DAV:sync-token Property

Clients typically discover sync support by PROPFIND on the collection and reading `DAV:sync-token`. A server that supports sync SHOULD expose a stable, opaque token here.

RFC 6578 also requires:
- The `DAV:sync-token` property MUST be defined on all resources that support `DAV:sync-collection`.
- The property value MUST be protected.
- The property value SHOULD NOT be returned by `PROPFIND` `DAV:allprop`.

**Example PROPFIND**:
```xml
<D:propfind xmlns:D="DAV:">
    <D:prop>
        <D:sync-token/>
    </D:prop>
</D:propfind>
```

**Example Response Fragment**:
```xml
<D:prop>
    <D:sync-token>http://example.com/sync/12345</D:sync-token>
</D:prop>
```

### 7.1.1 sync-collection Report

The `sync-collection` REPORT is how clients ask for “what changed since token X”.

- The request body MUST include `DAV:sync-token`, `DAV:sync-level`, and `DAV:prop` (and MAY include `DAV:limit`).
- `DAV:sync-level` MUST be either `1` (immediate children only) or `infinite` (all descendants, but only traversing into child collections that also support sync).
- Tokens are not specific to `sync-level`: clients MAY reuse a token obtained with one `sync-level` value for a later request with a different `sync-level` value.
- Initial sync is done by sending an empty `DAV:sync-token` element.
- On initial sync (empty token), the server MUST return all member URLs (subject to `sync-level`) and MUST NOT return removed member URLs.

Token validation (RFC 6578 §3.2):
- On subsequent sync (non-empty token), the `DAV:sync-token` value MUST have been previously returned by the server for the target collection.
- If the token is out-of-date/invalidated, fail the request with the `DAV:valid-sync-token` precondition error and the client will fall back to a full sync using an empty token.
- Servers MUST limit token invalidation to cases where it is absolutely necessary (e.g., bounded history, data loss, implementation change).

```xml
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token>http://example.com/sync/12345</D:sync-token>
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:sync-collection>
```

Response includes:
- Changed/new resources since sync-token (each `DAV:response` MUST include at least one `DAV:propstat` and MUST NOT include a `DAV:status`)
- Deleted resources (each `DAV:response` MUST include `DAV:status: 404 Not Found` and MUST NOT include any `DAV:propstat`)
- One new `DAV:sync-token` for the response

Child collections with `sync-level: infinite` (RFC 6578 §3.3):
- If a child collection cannot be synchronized as part of an `infinite` request, include a `DAV:response` for that child collection with `DAV:status: 403 Forbidden` and a `DAV:error` element.
- Use `DAV:error` containing `DAV:supported-report` when the child does not support `sync-collection` at all.
- Use `DAV:error` containing `DAV:sync-traversal-supported` when the child supports sync but the server refuses traversal from the parent scope.
- Emit that 403 response once, when the child collection is first reported.

Truncation / paging (RFC 6578 §3.6):
- A server MAY truncate results.
- When truncated, the response is still `207 Multi-Status`, but you MUST include an extra `DAV:response` for the request-URI with `DAV:status: 507 Insufficient Storage`, and it SHOULD include `DAV:error` with `DAV:number-of-matches-within-limits`.
- The returned `DAV:sync-token` MUST represent the partial result state so the client can re-issue the report with the new token to fetch the next “page” of changes.

`DAV:limit` handling (RFC 6578 §3.7):
- If the client specifies a limit and the server cannot correctly truncate at or below that limit, the server MUST fail the request with the `DAV:number-of-matches-within-limits` error.

### 7.1.2 Sync Token Strategy

Use monotonic `synctoken` on collection (bigint, increments on any change).

Track per-resource `sync_revision` to identify changes since a given token.

Tombstones (`dav_tombstone`) track deleted resources with their `sync_revision` at deletion time.

```sql
-- Find changes since token
SELECT uri, etag, sync_revision 
FROM dav_instance 
WHERE collection_id = ? AND sync_revision > ?
UNION ALL
SELECT uri, NULL, sync_revision
FROM dav_tombstone
WHERE collection_id = ? AND sync_revision > ?;
```

### 7.1.3 Using DAV:sync-token with the If Header

RFC 6578 requires servers to support use of `DAV:sync-token` values in `If` request headers, so clients can make write operations conditional on the collection not having changed since the last sync.

- Support `If` with a collection “resource tag” targeting the collection URI and the sync-token as the state token.
- Return `412 Precondition Failed` when the token no longer matches.

## 7.2 CTag (Calendar Server Extension)

`CS:getctag` property: opaque token that changes when collection contents change.

Implementation: use `synctoken` value or hash of all ETags.

## 7.3 ETag Handling

- Generate strong ETag for each resource
- Include in GET/PUT responses
- Validate `If-Match` / `If-None-Match` headers
- Consider: `"{entity_id}-{revision}"` format

---
