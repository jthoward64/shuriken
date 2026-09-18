import type { PrincipalId } from "#src/domain/ids.ts";
import type { PropfindKind } from "#src/http/dav/methods/instance-props.ts";

/** What every PROPFIND branch needs beyond the resolved path */
export interface PropfindContext {
	readonly actingPrincipalId: PrincipalId;
	/** href of the acting principal, for DAV:current-user-principal */
	readonly actingPrincipalHref: string;
	readonly origin: string;
	readonly request: PropfindKind;
	readonly depth: 0 | 1;
}
