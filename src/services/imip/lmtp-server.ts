// ---------------------------------------------------------------------------
// LmtpServerLayer — boots a Deno TCP listener that speaks LMTP and forwards
// successfully-decoded messages to ImipInboundService. Per-connection state
// lives in lmtp-connection.ts so concurrent clients can't bleed into each
// other.
//
// Deno's socket API is stream-shaped, not Effect-shaped, so we hop out of
// Effect into the context it's running on (captured via Effect.context). Each
// per-recipient delivery is wrapped so failures are logged but don't tear down
// the listener.
// ---------------------------------------------------------------------------

import type { Cause } from "effect";
import { Effect, Layer } from "effect";
import { AppConfigService } from "#src/config.ts";
import { ImipInboundService } from "./inbound.ts";
import { closeQuietly, serveConnection } from "./lmtp-connection.ts";

/** Log an unexpected handler failure, then re-raise it as a defect */
const dieLogged = Effect.fn("imip.lmtp.dieLogged")(function* (
	cause: Cause.Cause<unknown>,
) {
	yield* Effect.logError("imip.lmtp: handler failed", { cause });
	return yield* Effect.die(cause);
});

/** Accept connections until the listener is closed during shutdown */
const acceptLoop = Effect.fn("imip.lmtp.acceptLoop")(function* (
	listener: Deno.Listener,
	onConnection: (conn: Deno.Conn) => void,
) {
	yield* Effect.tryPromise(async () => {
		for await (const conn of listener) {
			onConnection(conn);
		}
	}).pipe(Effect.ignore);
});

/** Bind the LMTP port and run its accept loop detached from the caller */
const startListener = Effect.fn("imip.lmtp.startListener")(function* (opts: {
	readonly host: string;
	readonly port: number;
	readonly onConnection: (conn: Deno.Conn) => void;
	readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
}) {
	const listener = yield* Effect.sync(() =>
		Deno.listen({ hostname: opts.host, port: opts.port }),
	);
	void opts.runPromise(acceptLoop(listener, opts.onConnection));
	return listener;
});

export const LmtpServerLayer = Layer.effectDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfigService;
		if (!config.mail.lmtpEnabled) {
			yield* Effect.logDebug("imip.lmtp: disabled, not listening");
			return;
		}
		const inbound = yield* ImipInboundService;
		const context = yield* Effect.context<never>();

		// Bridge out of Effect onto the layer's context for the socket callbacks
		const runPromise = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
			Effect.runPromiseWith(context)(effect);

		// A delivery that fails is logged and rejected, becoming a 451 for that RCPT
		const runDelivery = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
			runPromise(effect.pipe(Effect.catchCause(dieLogged)));

		const hostname = "shuriken";
		const host = config.mail.lmtpHost;
		const port = config.mail.lmtpPort;

		yield* Effect.acquireRelease(
			startListener({
				host,
				port,
				runPromise,
				onConnection: (conn) =>
					serveConnection(conn, {
						hostname,
						limits: {
							maxDataBytes: config.mail.lmtpMaxDataBytes,
							maxRecipients: config.mail.lmtpMaxRecipients,
						},
						runPromise,
						deliver: (recipient, body) =>
							runDelivery(
								inbound.process({
									recipientEmail: recipient,
									rawMessage: body,
								}),
							),
					}),
			}),
			(listener) => Effect.sync(() => closeQuietly(listener)),
		);

		yield* Effect.logInfo("imip.lmtp: listening", { host, port });
	}),
);
