import { Option } from "effect";
import { KNOWN_ROLES, normaliseRole } from "#src/services/role/policy.ts";

// ---------------------------------------------------------------------------
// resolveRoleFromGroups — pick the app role implied by a user's IdP groups.
//
// Each group is looked up in `roleMap`; among the mapped roles the
// highest-privilege one wins (precedence follows the order of KNOWN_ROLES, so
// super_admin > admin > normal). Returns None when no group maps to a role —
// the caller decides whether that means "default role" or "leave unchanged".
// ---------------------------------------------------------------------------

const roleRank = (role: string): number =>
	KNOWN_ROLES.indexOf(normaliseRole(role));

export const resolveRoleFromGroups = (
	groups: ReadonlyArray<string>,
	roleMap: ReadonlyMap<string, string>,
): Option.Option<string> => {
	let winner: string | undefined;
	for (const group of groups) {
		const mapped = roleMap.get(group);
		if (mapped === undefined) {
			continue;
		}
		if (winner === undefined || roleRank(mapped) > roleRank(winner)) {
			winner = mapped;
		}
	}
	return winner === undefined ? Option.none() : Option.some(winner);
};
