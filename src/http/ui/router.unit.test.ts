import { describe, expect, it } from "bun:test";
import { Effect, Layer, Option, Redacted } from "effect";
import { AppConfigService } from "#src/config.ts";
import type { PrincipalId, RequestId, UserId } from "#src/domain/ids.ts";
import { Authenticated } from "#src/domain/types/dav.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_NOT_FOUND } from "#src/http/status.ts";
import { TemplateService } from "#src/http/ui/template/index.ts";
import { BunFileService } from "#src/platform/file.ts";
import { AclService } from "#src/services/acl/index.ts";
import { GroupService } from "#src/services/group/index.ts";
import { PrincipalService } from "#src/services/principal/index.ts";
import { UserService } from "#src/services/user/index.ts";
import { uiRouter } from "./router.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const die = () => Effect.die("stub");

const authenticated = new Authenticated({
	principal: {
		principalId: "00000000-0000-4000-8000-000000000001" as PrincipalId,
		userId: "00000000-0000-4000-8000-000000000002" as UserId,
		displayName: Option.some("Test User"),
	},
});

const makeCtx = (path: string, method = "GET"): HttpRequestContext => ({
	requestId: "00000000-0000-4000-8000-000000000000" as RequestId,
	method,
	url: new URL(`http://localhost${path}`),
	headers: new Headers(),
	auth: authenticated,
	clientIp: Option.none(),
	caldavTimezones: null,
});

const stubLayers = Layer.mergeAll(
	Layer.succeed(AppConfigService, {
		server: { port: 3000, host: "::" },
		database: { url: Redacted.make("postgres://localhost/test") },
		auth: {
			mode: "single-user" as const,
			proxyHeader: "X-Remote-User",
			trustedProxies: "*",
			adminEmail: Option.none(),
			adminPassword: Option.none(),
			adminSlug: Option.none(),
		},
		log: { level: undefined },
		nodeEnv: "test",
	} as unknown as AppConfigService),
	Layer.succeed(BunFileService, {
		readText: die,
		readBytes: die,
		exists: () => Effect.succeed(false),
		mimeType: () => undefined,
		glob: () => Effect.succeed([]),
	}),
	Layer.succeed(TemplateService, {
		render: (_name: string, _ctx: Record<string, unknown>, _isHtmx: boolean) =>
			Effect.succeed("<!DOCTYPE html><body>test</body>"),
		renderFragment: (_name: string, _ctx: Record<string, unknown>) =>
			Effect.succeed("<div>test</div>"),
	}),
	Layer.succeed(AclService, {
		check: die,
		currentUserPrivileges: () => Effect.succeed([]),
		batchCurrentUserPrivileges: () => Effect.succeed(new Map()),
		getAces: die,
		setAces: die,
	}),
	Layer.succeed(PrincipalService, {
		findById: die,
		findBySlug: die,
		findByEmail: die,
		updateProperties: die,
	}),
	Layer.succeed(UserService, {
		create: die,
		list: die,
		findById: die,
		findBySlug: die,
		update: die,
		delete: die,
		addCredential: die,
		removeCredential: die,
		setCredential: die,
	}),
	Layer.succeed(GroupService, {
		create: die,
		findById: die,
		findBySlug: die,
		list: die,
		listMembers: die,
		listByMember: die,
		update: die,
		delete: die,
		setMembers: die,
		addMember: die,
		removeMember: die,
	}),
);

const run = (path: string, method = "GET"): Promise<Response> => {
	const req = new Request(`http://localhost${path}`, { method });
	const ctx = makeCtx(path, method);
	return Effect.runPromise(Effect.provide(uiRouter(req, ctx), stubLayers));
};

describe("uiRouter", () => {
	it("routes / to home page (200 with HTML)", async () => {
		const res = await run("/");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
	});

	it("routes /ui to home page (200 with HTML)", async () => {
		const res = await run("/ui");
		expect(res.status).toBe(200);
	});

	it("routes /static/* to staticHandler (404 — no assets in test)", async () => {
		const res = await run("/static/app.js");
		expect(res.status).toBe(HTTP_NOT_FOUND);
	});

	it("returns 404 for unknown paths", async () => {
		const res = await run("/ui/unknown/path/that/does/not/exist");
		expect(res.status).toBe(HTTP_NOT_FOUND);
	});
});
