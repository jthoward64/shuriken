/** biome-ignore-all lint/style/noMagicNumbers: CIDR prefix lengths and hextet widths are IANA/RFC-defined */
import { lookup } from "node:dns/promises";
import { Context, Effect, Layer } from "effect";
import { InternalError } from "#src/domain/errors.ts";

// ---------------------------------------------------------------------------
// NetworkGuardService — SSRF defense for outbound fetches driven by
// user-supplied URLs (external calendar subscriptions today). Resolves a
// hostname to its concrete IP addresses via `node:dns` (portable across
// Deno/Node, unlike `Deno.resolveDns`) so callers can reject loopback/
// private/link-local/metadata targets *before* connecting — and must
// re-resolve on every redirect hop, since the first hop's address says
// nothing about where a 3xx points next (DNS rebinding, redirect-to-metadata).
// ---------------------------------------------------------------------------

export interface NetworkGuardServiceShape {
	/** Resolve a hostname to its IPv4/IPv6 addresses. A literal IP resolves to itself. */
	readonly resolveAddresses: (
		hostname: string,
	) => Effect.Effect<ReadonlyArray<string>, InternalError>;
}

export class NetworkGuardService extends Context.Service<
	NetworkGuardService,
	NetworkGuardServiceShape
>()("NetworkGuardService") {}

const ipv4ToInt = (ip: string): number | null => {
	const parts = ip.split(".");
	if (parts.length !== 4) {
		return null;
	}
	let n = 0;
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) {
			return null;
		}
		const v = Number(part);
		if (v > 255) {
			return null;
		}
		n = (n << 8) | v;
	}
	return n >>> 0;
};

const IPV4_MASK_BITS = 32;

const inCidr4 = (ip: number, base: string, prefixBits: number): boolean => {
	const baseInt = ipv4ToInt(base);
	if (baseInt === null) {
		return false;
	}
	const mask =
		prefixBits === 0 ? 0 : (~0 << (IPV4_MASK_BITS - prefixBits)) >>> 0;
	return (ip & mask) >>> 0 === (baseInt & mask) >>> 0;
};

// RFC 1918 private ranges, loopback, link-local (incl. the 169.254.169.254
// cloud metadata address), CGNAT, "this network," benchmarking, multicast,
// and reserved space. Fail-closed: anything not clearly public is blocked.
const IPV4_BLOCKED_RANGES: ReadonlyArray<readonly [string, number]> = [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
];

const isBlockedIpv4 = (ip: string): boolean => {
	const n = ipv4ToInt(ip);
	if (n === null) {
		return true;
	}
	return IPV4_BLOCKED_RANGES.some(([base, bits]) => inCidr4(n, base, bits));
};

const HEXTET_GROUPS = 8;
const HEXTET_BITS = 16n;

/** Parse a (possibly v4-mapped/compressed) IPv6 literal into a 128-bit integer. */
const ipv6ToBigInt = (ip: string): bigint | null => {
	let addr = ip;
	const v4Embedded = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr);
	if (v4Embedded?.[1]) {
		const v4 = ipv4ToInt(v4Embedded[1]);
		if (v4 === null) {
			return null;
		}
		const hex = v4.toString(16).padStart(8, "0");
		addr = `${addr.slice(0, -v4Embedded[1].length)}${hex.slice(0, 4)}:${hex.slice(4)}`;
	}

	const halves = addr.split("::");
	if (halves.length > 2) {
		return null;
	}
	const head = halves[0] ? halves[0].split(":").filter((g) => g !== "") : [];
	const tail =
		halves.length === 2 && halves[1]
			? halves[1].split(":").filter((g) => g !== "")
			: [];
	const missing = HEXTET_GROUPS - head.length - tail.length;
	if (halves.length === 1) {
		if (missing !== 0) {
			return null;
		}
	} else if (missing < 0) {
		return null;
	}
	const groups = [
		...head,
		...new Array(halves.length === 2 ? missing : 0).fill("0"),
		...tail,
	];
	if (groups.length !== HEXTET_GROUPS) {
		return null;
	}
	let result = 0n;
	for (const g of groups) {
		if (!/^[0-9a-f]{1,4}$/i.test(g)) {
			return null;
		}
		result = (result << HEXTET_BITS) | BigInt(Number.parseInt(g, 16));
	}
	return result;
};

const IPV6_BITS = 128n;

const inCidr6 = (addr: bigint, base: string, prefixBits: number): boolean => {
	const baseInt = ipv6ToBigInt(base);
	if (baseInt === null) {
		return false;
	}
	const shift = IPV6_BITS - BigInt(prefixBits);
	const mask =
		prefixBits === 0 ? 0n : ((1n << BigInt(prefixBits)) - 1n) << shift;
	return (addr & mask) === (baseInt & mask);
};

// Loopback, unspecified, link-local, unique-local (fc00::/7), v4-mapped
// (re-checked against the embedded v4 above via ipv6ToBigInt), NAT64, IPv4
// compatible, documentation, and multicast.
const IPV6_BLOCKED_RANGES: ReadonlyArray<readonly [string, number]> = [
	["::1", 128],
	["::", 128],
	["::ffff:0:0", 96],
	["64:ff9b::", 96],
	["100::", 64],
	["2001:db8::", 32],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
];

const isBlockedIpv6 = (ip: string): boolean => {
	const addr = ipv6ToBigInt(ip);
	if (addr === null) {
		return true;
	}
	return IPV6_BLOCKED_RANGES.some(([base, bits]) => inCidr6(addr, base, bits));
};

/** True if `ip` (already a resolved literal, no hostname) must not be fetched. */
export const isBlockedAddress = (ip: string): boolean =>
	ip.includes(":") ? isBlockedIpv6(ip) : isBlockedIpv4(ip);

export const NetworkGuardServiceLive = Layer.succeed(NetworkGuardService, {
	resolveAddresses: (hostname) =>
		Effect.tryPromise({
			try: async () => {
				const bare = hostname.replace(/^\[|\]$/g, "");
				const results = await lookup(bare, { all: true });
				return results.map((r) => r.address);
			},
			catch: (e) => new InternalError({ cause: e }),
		}),
});
