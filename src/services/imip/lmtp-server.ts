import { Effect, Layer, Runtime } from "effect";
import { AppConfigService } from "#src/config.ts";
import { ImipInboundService } from "./inbound.ts";
import {
	apply,
	formatReply,
	greeting,
	initialState,
	type LmtpState,
	parseCommand,
} from "./lmtp-protocol.ts";

// ---------------------------------------------------------------------------
// LmtpServerLayer — boots a Bun TCP listener that speaks LMTP and forwards
// successfully-decoded messages to ImipInboundService. Per-connection state
// lives in a closure on `data` so concurrent clients can't bleed into each
// other.
//
// Bun.listen's socket API is callback-shaped, not Effect-shaped, so we hop
// out of Effect into the runtime it's running on (passed in via Layer.scoped
// + Runtime.runtime). Each per-recipient delivery is wrapped in
// `runtime.runPromise` so failures are logged but don't tear down the
// listener.
//
// LMTP semantics (RFC 2033 §4.2): the server sends one reply per RCPT TO
// after DATA terminates. We process recipients sequentially because they
// share one parsed MIME tree.
// ---------------------------------------------------------------------------

interface ConnectionState {
	state: LmtpState;
	pending: string;
}

// Drain a buffer of "lines terminated by CRLF" — leftover (no trailing CRLF
// yet) becomes the next-call's pending value.
const splitLines = (
	chunk: string,
	pending: string,
): { readonly lines: ReadonlyArray<string>; readonly tail: string } => {
	const combined = pending + chunk;
	const parts = combined.split("\r\n");
	const tail = parts.pop() ?? "";
	return { lines: parts, tail };
};

export const LmtpServerLayer = Layer.scopedDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfigService;
		if (!config.mail.lmtpEnabled) {
			yield* Effect.logDebug("imip.lmtp: disabled, not listening");
			return;
		}
		const inbound = yield* ImipInboundService;

		const runtime = yield* Effect.runtime<never>();
		const runPromise = Runtime.runPromise(runtime);
		const runFork = <A>(eff: Effect.Effect<A, unknown, never>): Promise<A> =>
			runPromise(
				eff.pipe(
					Effect.catchAllCause((cause) =>
						Effect.logError("imip.lmtp: handler failed", { cause }).pipe(
							Effect.flatMap(() => Effect.die(cause)),
						),
					),
				),
			);

		const hostname = "shuriken";
		const port = config.mail.lmtpPort;
		const host = config.mail.lmtpHost;

		yield* Effect.acquireRelease(
			Effect.sync(() => {
				const server = Bun.listen<ConnectionState>({
					hostname: host,
					port,
					socket: {
						open(socket) {
							socket.data = { state: initialState, pending: "" };
							socket.write(formatReply(greeting(hostname)));
						},
						data(socket, chunk) {
							const text = chunk.toString("utf8");
							const inDataBefore = socket.data.state.tag === "Data";
							const { lines, tail } = splitLines(text, socket.data.pending);
							socket.data.pending = tail;
							let inData = inDataBefore;
							for (const line of lines) {
								const cmd = parseCommand(line, inData);
								const step = apply(socket.data.state, cmd, hostname);
								socket.data.state = step.state;
								for (const reply of step.replies) {
									socket.write(formatReply(reply));
								}
								inData = step.state.tag === "Data";
								if (step.delivery !== undefined) {
									const { recipients, body } = step.delivery;
									// Process recipients sequentially. Each gets its own
									// 250/5xx reply so the upstream MTA can fan-out.
									for (const recipient of recipients) {
										runFork(
											Effect.gen(function* () {
												const outcome = yield* inbound.process({
													recipientEmail: recipient,
													rawMessage: body,
												});
												return outcome;
											}),
										)
											.then((outcome) => {
												if (outcome._tag === "Applied") {
													socket.write(
														formatReply({
															code: 250,
															text: `Delivered ${recipient}`,
														}),
													);
												} else if (outcome._tag === "UnknownRecipient") {
													socket.write(
														formatReply({
															code: 550,
															text: `No such user: ${recipient}`,
														}),
													);
												} else if (outcome._tag === "MissingCalendar") {
													socket.write(
														formatReply({
															code: 550,
															text: `No primary calendar for ${recipient}`,
														}),
													);
												} else if (outcome._tag === "NotImip") {
													socket.write(
														formatReply({
															code: 550,
															text: "Not an iMIP message",
														}),
													);
												} else {
													socket.write(
														formatReply({
															code: 550,
															text: `Malformed iCalendar: ${outcome.cause}`,
														}),
													);
												}
											})
											.catch(() => {
												socket.write(
													formatReply({
														code: 451,
														text: "Temporary failure",
													}),
												);
											});
									}
								}
								if (step.close === true) {
									socket.end();
								}
							}
						},
						error(_socket, error) {
							void runPromise(
								Effect.logWarning("imip.lmtp: socket error", {
									error: String(error),
								}),
							);
						},
					},
				});
				return server;
			}),
			(server) =>
				Effect.sync(() => {
					server.stop(true);
				}),
		);

		yield* Effect.logInfo("imip.lmtp: listening", { host, port });
	}),
);
