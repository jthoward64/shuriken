import { eq } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { AuthService } from "#src/auth/service.ts";
import { AppConfigService } from "#src/config.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { principal, user } from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import { PrincipalId, UserId } from "#src/domain/ids.ts";
import { Authenticated, Unauthenticated } from "#src/domain/types/dav.ts";

// ---------------------------------------------------------------------------
// Proxy auth layer
//
// Trusts a reverse proxy to handle authentication. The proxy injects the
// authenticated username via a configurable header (default: X-Remote-User).
//
// Trusted-proxy checking is performed per-request based on client IP.
// TRUSTED_PROXIES="*"               → trust all (default)
// TRUSTED_PROXIES="127.0.0.1,::1"  → exact IP match (v4 or v6)
// TRUSTED_PROXIES="192.168.1.0/24" → IPv4 CIDR match
// TRUSTED_PROXIES="fd00::/8"        → IPv6 CIDR match
// ---------------------------------------------------------------------------

/** Convert a dotted-decimal IPv4 string to a 32-bit unsigned integer. */
const ipv4ToNum = (ip: string): number =>
	ip
		.split(".")
		.reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0) >>> 0;

/**
 * Expand a (possibly compressed) IPv6 address string to its 8 full groups and
 * return as a 128-bit BigInt.
 */
const ipv6ToBigInt = (ip: string): bigint => {
	const halves = ip.split("::");
	let groups: Array<string>;
	if (halves.length === 2) {
		const left = halves[0] ? halves[0].split(":") : [];
		const right = halves[1] ? halves[1].split(":") : [];
		const ipv6Groups = 8;
		const padding = new Array<string>(
			ipv6Groups - left.length - right.length,
		).fill("0");
		groups = [...left, ...padding, ...right];
	} else {
		groups = ip.split(":");
	}
	return groups.reduce(
		(acc, g) => (acc << 16n) | BigInt(Number.parseInt(g || "0", 16)),
		0n,
	);
};

/**
 * Returns true if `ip` falls within the IPv4 CIDR block `cidr` (e.g. "10.0.0.0/8").
 * Returns false if either argument is not a valid IPv4 address / CIDR.
 */
const ipv4InCidr = (ip: string, cidr: string): boolean => {
	const slashIdx = cidr.lastIndexOf("/");
	if (slashIdx === -1) {
		return false;
	}
	const network = cidr.slice(0, slashIdx);
	const bits = Number(cidr.slice(slashIdx + 1));
	const ipv4Bits = 32;
	if (Number.isNaN(bits) || bits < 0 || bits > ipv4Bits) {
		return false;
	}
	const mask = bits === 0 ? 0 : ~((1 << (ipv4Bits - bits)) - 1) >>> 0;
	return (ipv4ToNum(ip) & mask) === (ipv4ToNum(network) & mask);
};

/**
 * Returns true if `ip` falls within the IPv6 CIDR block `cidr` (e.g. "fd00::/8").
 * Returns false if either argument is not a valid IPv6 address / CIDR.
 */
const ipv6InCidr = (ip: string, cidr: string): boolean => {
	const slashIdx = cidr.lastIndexOf("/");
	if (slashIdx === -1) {
		return false;
	}
	const network = cidr.slice(0, slashIdx);
	const bits = Number(cidr.slice(slashIdx + 1));
	const ipv6Bits = 128;
	if (Number.isNaN(bits) || bits < 0 || bits > ipv6Bits) {
		return false;
	}
	const maxVal = (1n << BigInt(ipv6Bits)) - 1n;
	const mask =
		bits === 0 ? 0n : ~((1n << BigInt(ipv6Bits - bits)) - 1n) & maxVal;
	return (ipv6ToBigInt(ip) & mask) === (ipv6ToBigInt(network) & mask);
};

/**
 * Returns true if `ip` matches the given `entry`, which may be:
 *   - An exact IP address (IPv4 or IPv6)
 *   - An IPv4 CIDR block (contains "." and "/")
 *   - An IPv6 CIDR block (contains ":" and "/")
 */
const matchesEntry = (ip: string, entry: string): boolean => {
	if (!entry.includes("/")) {
		return entry === ip;
	}
	const networkPart = entry.slice(0, entry.lastIndexOf("/"));
	return networkPart.includes(":")
		? ipv6InCidr(ip, entry)
		: ipv4InCidr(ip, entry);
};

export const isClientTrusted = (
	clientIp: Option.Option<string>,
	trustedProxies: string,
): boolean =>
	trustedProxies === "*" ||
	Option.match(clientIp, {
		onNone: () => false,
		onSome: (ip) =>
			trustedProxies
				.split(",")
				.map((s) => s.trim())
				.some((entry) => matchesEntry(ip, entry)),
	});

export const ProxyAuthLayer = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const db = yield* DatabaseClient;
		const {
			auth: { proxyHeader, trustedProxies },
		} = yield* AppConfigService;

		return AuthService.of({
			authenticate: Effect.fn("auth.authenticate")(
				function* (headers, clientIp) {
					// If the request doesn't come from a trusted proxy, ignore the header
					if (!isClientTrusted(clientIp, trustedProxies)) {
						yield* Effect.logDebug("proxy auth: untrusted client", {
							clientIp: Option.getOrUndefined(clientIp),
						});
						return new Unauthenticated();
					}

					const username = headers.get(proxyHeader);
					if (!username) {
						yield* Effect.logDebug("proxy auth: header absent", {
							proxyHeader,
						});
						return new Unauthenticated();
					}

					yield* Effect.logTrace("proxy auth attempt", { username });

					const rows = yield* Effect.tryPromise({
						try: () =>
							db
								.select({
									userId: user.id,
									principalId: user.principalId,
									displayName: principal.displayName,
								})
								.from(user)
								.innerJoin(principal, eq(user.principalId, principal.id))
								.where(eq(user.email, username))
								.limit(1),
						catch: (e) => new DatabaseError({ cause: e }),
					});

					const row = rows[0];
					if (!row) {
						yield* Effect.logDebug("proxy auth: user not found", { username });
						return new Unauthenticated();
					}

					yield* Effect.logTrace("proxy auth: succeeded", {
						userId: row.userId,
					});
					return new Authenticated({
						principal: {
							principalId: PrincipalId(row.principalId),
							userId: UserId(row.userId),
							displayName: Option.fromNullable(row.displayName),
						},
					});
				},
			),
		});
	}),
);
