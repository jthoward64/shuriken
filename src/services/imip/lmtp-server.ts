import { Effect, Layer, Runtime } from "effect";
import { AppConfigService } from "#src/config.ts";
import type { ImipInboundOutcome } from "./inbound.ts";
import { ImipInboundService } from "./inbound.ts";
import {
	apply,
	type DeliveryOutcome,
	formatReply,
	greeting,
	initialState,
	type LmtpState,
	parseCommand,
	renderDeliveryReplies,
} from "./lmtp-protocol.ts";

const outcomeToDelivery = (o: ImipInboundOutcome): DeliveryOutcome => {
	switch (o._tag) {
		case "Applied":
			return { tag: "Applied" };
		case "UnknownRecipient":
			return { tag: "UnknownRecipient" };
		case "MissingCalendar":
			return { tag: "MissingCalendar" };
		case "NotImip":
			return { tag: "NotImip" };
		case "MalformedIcs":
			return { tag: "MalformedIcs", cause: o.cause };
	}
};

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
	/** Outstanding delivery `Promise.allSettled` chains. `socket.end()` is
	 * deferred until all complete — otherwise pipelined `DATA\r\n.\r\nQUIT`
	 * closes before the per-RCPT 250/5xx replies are written, leaving the
	 * upstream MTA to retry messages we already accepted. */
	pendingDeliveries: number;
	/** True once QUIT has been received; closing waits for pending=0. */
	closeRequested: boolean;
	/** 221 reply (and any others returned alongside close) held until the
	 * mid-flight deliveries finish, so replies stay in protocol order. */
	heldCloseReplies?: ReadonlyArray<import("./lmtp-protocol.ts").LmtpReply>;
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
							socket.data = {
								state: initialState,
								pending: "",
								pendingDeliveries: 0,
								closeRequested: false,
							};
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
								// QUIT's 221 reply is held back while a delivery is in
								// flight so the per-RCPT 250/5xx replies aren't sent
								// AFTER the close acknowledgement (which would make the
								// upstream MTA distrust them).
								const holdReplies =
									step.close === true && socket.data.pendingDeliveries > 0;
								if (!holdReplies) {
									for (const reply of step.replies) {
										socket.write(formatReply(reply));
									}
								}
								inData = step.state.tag === "Data";
								if (step.delivery !== undefined) {
									const { recipients, body } = step.delivery;
									socket.data.pendingDeliveries += 1;
									// RFC 2033 §4.2: one reply per RCPT TO, in the order
									// they were issued. Dispatch in parallel, then render
									// replies in RCPT order from the collected outcomes.
									const tasks = recipients.map((recipient) =>
										runFork(
											Effect.gen(function* () {
												const outcome = yield* inbound.process({
													recipientEmail: recipient,
													rawMessage: body,
												});
												return outcome;
											}),
										),
									);
									void Promise.allSettled(tasks).then((results) => {
										const outcomes: ReadonlyArray<DeliveryOutcome> =
											results.map((r) =>
												r.status === "rejected"
													? ({ tag: "Rejected" } as const)
													: outcomeToDelivery(r.value),
											);
										for (const reply of renderDeliveryReplies(
											recipients,
											outcomes,
										)) {
											socket.write(formatReply(reply));
										}
										socket.data.pendingDeliveries -= 1;
										if (
											socket.data.closeRequested &&
											socket.data.pendingDeliveries === 0
										) {
											// Emit the held 221 (and any companion replies)
											// in protocol order, then close.
											for (const r of socket.data.heldCloseReplies ?? []) {
												socket.write(formatReply(r));
											}
											socket.end();
										}
									});
								}
								if (step.close === true) {
									// QUIT received. If a delivery is mid-flight, defer
									// the 221 + close until per-RCPT replies are flushed.
									if (socket.data.pendingDeliveries > 0) {
										socket.data.closeRequested = true;
										socket.data.heldCloseReplies = step.replies;
									} else {
										socket.end();
									}
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
