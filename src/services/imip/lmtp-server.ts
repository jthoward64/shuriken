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
	type LmtpReply,
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
// LmtpServerLayer — boots a Deno TCP listener that speaks LMTP and forwards
// successfully-decoded messages to ImipInboundService. Per-connection state
// lives in a closure so concurrent clients can't bleed into each other.
//
// Deno's socket API is stream-shaped, not Effect-shaped, so we hop out of
// Effect into the runtime it's running on (passed in via Layer.scoped +
// Runtime.runtime). Each per-recipient delivery is wrapped in
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
	heldCloseReplies?: ReadonlyArray<LmtpReply>;
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

		// ---------------------------------------------------------------------
		// Per-connection handler. Deno's socket API is stream-shaped (async
		// read loop + Promise-returning writes), unlike Bun's callback socket,
		// so connection state lives in a closure and all writes are serialized
		// through `writeChain` to keep protocol replies in byte order even when
		// async delivery replies race with synchronous command replies.
		// ---------------------------------------------------------------------
		const encoder = new TextEncoder();
		const handleConn = (conn: Deno.Conn): void => {
			const data: ConnectionState = {
				state: initialState,
				pending: "",
				pendingDeliveries: 0,
				closeRequested: false,
			};
			let closed = false;
			let writeChain: Promise<unknown> = Promise.resolve();

			const write = (reply: LmtpReply): void => {
				const bytes = encoder.encode(formatReply(reply));
				writeChain = writeChain
					.then(() => (closed ? undefined : conn.write(bytes)))
					.catch(() => {
						closed = true;
					});
			};
			const closeConn = (): void => {
				closed = true;
				void writeChain.finally(() => {
					try {
						conn.close();
					} catch {
						// already closed
					}
				});
			};

			write(greeting(hostname));

			const processText = (text: string): void => {
				const inDataBefore = data.state.tag === "Data";
				const { lines, tail } = splitLines(text, data.pending);
				data.pending = tail;
				let inData = inDataBefore;
				for (const line of lines) {
					const cmd = parseCommand(line, inData);
					const step = apply(data.state, cmd, hostname);
					data.state = step.state;
					// QUIT's 221 reply is held back while a delivery is in flight
					// so the per-RCPT 250/5xx replies aren't sent AFTER the close
					// acknowledgement (which would make the upstream MTA distrust
					// them).
					const holdReplies = step.close === true && data.pendingDeliveries > 0;
					if (!holdReplies) {
						for (const reply of step.replies) {
							write(reply);
						}
					}
					inData = step.state.tag === "Data";
					if (step.delivery !== undefined) {
						const { recipients, body } = step.delivery;
						data.pendingDeliveries += 1;
						// RFC 2033 §4.2: one reply per RCPT TO, in the order they
						// were issued. Dispatch in parallel, then render replies in
						// RCPT order from the collected outcomes.
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
							const outcomes: ReadonlyArray<DeliveryOutcome> = results.map(
								(r) =>
									r.status === "rejected"
										? ({ tag: "Rejected" } as const)
										: outcomeToDelivery(r.value),
							);
							for (const reply of renderDeliveryReplies(recipients, outcomes)) {
								write(reply);
							}
							data.pendingDeliveries -= 1;
							if (data.closeRequested && data.pendingDeliveries === 0) {
								// Emit the held 221 (and any companion replies) in
								// protocol order, then close.
								for (const r of data.heldCloseReplies ?? []) {
									write(r);
								}
								closeConn();
							}
						});
					}
					if (step.close === true) {
						// QUIT received. If a delivery is mid-flight, defer the 221 +
						// close until per-RCPT replies are flushed.
						if (data.pendingDeliveries > 0) {
							data.closeRequested = true;
							data.heldCloseReplies = step.replies;
						} else {
							closeConn();
						}
					}
				}
			};

			void (async () => {
				const decoder = new TextDecoder();
				try {
					for await (const chunk of conn.readable) {
						processText(decoder.decode(chunk, { stream: true }));
						if (closed) {
							break;
						}
					}
				} catch (error) {
					void runPromise(
						Effect.logWarning("imip.lmtp: socket error", {
							error: String(error),
						}),
					);
				}
			})();
		};

		yield* Effect.acquireRelease(
			Effect.sync(() => {
				const listener = Deno.listen({ hostname: host, port });
				void (async () => {
					try {
						for await (const conn of listener) {
							handleConn(conn);
						}
					} catch {
						// Listener closed during shutdown — accept loop ends.
					}
				})();
				return listener;
			}),
			(listener) =>
				Effect.sync(() => {
					try {
						listener.close();
					} catch {
						// already closed
					}
				}),
		);

		yield* Effect.logInfo("imip.lmtp: listening", { host, port });
	}),
);
