// ---------------------------------------------------------------------------
// One LMTP connection (RFC 2033), driven by the pure state machine in
// lmtp-protocol.ts.
//
// Deno's socket API is stream-shaped (async read loop + Promise-returning
// writes), so per-connection state lives in a closure and all writes are
// serialized through `writeChain` to keep protocol replies in byte order even
// when async delivery replies race with synchronous command replies.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import type { ImipInboundOutcome } from "./inbound.ts";
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

/** The transport-independent collaborators one connection needs */
export interface ConnectionOptions {
	readonly hostname: string;
	readonly limits: {
		readonly maxDataBytes: number;
		readonly maxRecipients: number;
	};
	/** Deliver one recipient's copy; a rejection becomes a 451 for that RCPT */
	readonly deliver: (
		recipient: string,
		body: string,
	) => Promise<ImipInboundOutcome>;
	/** Run a logging (or other context-bound) Effect on the layer's context */
	readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
}

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

/** Map an inbound-processing outcome onto its LMTP per-recipient outcome */
const outcomeToDelivery = (o: ImipInboundOutcome): DeliveryOutcome =>
	o._tag === "MalformedIcs"
		? { tag: "MalformedIcs", cause: o.cause }
		: { tag: o._tag };

/** A settled delivery promise, with a rejection reported as an LMTP failure */
const settledToDelivery = (
	result: PromiseSettledResult<ImipInboundOutcome>,
): DeliveryOutcome =>
	result.status === "rejected"
		? { tag: "Rejected" }
		: outcomeToDelivery(result.value);

/** Close a handle, absorbing the error thrown when it is already closed */
export const closeQuietly = (closeable: { close: () => void }): void => {
	Effect.runSync(Effect.try(() => closeable.close()).pipe(Effect.ignore));
};

/** Read the socket until it closes or the handler stops, feeding decoded text on */
const readSocket = Effect.fn("imip.lmtp.readSocket")(function* (
	conn: Deno.Conn,
	onText: (text: string) => void,
	isClosed: () => boolean,
) {
	yield* Effect.tryPromise({
		try: async () => {
			const decoder = new TextDecoder();
			for await (const chunk of conn.readable) {
				onText(decoder.decode(chunk, { stream: true }));
				if (isClosed()) {
					break;
				}
			}
		},
		catch: (e) => String(e),
	});
});

/**
 * Serve one accepted connection. Returns immediately; the read loop and the
 * per-recipient deliveries run detached so the accept loop is never blocked.
 */
export const serveConnection = (
	conn: Deno.Conn,
	options: ConnectionOptions,
): void => {
	const encoder = new TextEncoder();
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
		void writeChain.finally(() => closeQuietly(conn));
	};

	// Flush the per-RCPT replies, then release a close that was waiting on them
	const finishDelivery = (
		recipients: ReadonlyArray<string>,
		results: ReadonlyArray<PromiseSettledResult<ImipInboundOutcome>>,
	): void => {
		for (const reply of renderDeliveryReplies(
			recipients,
			results.map(settledToDelivery),
		)) {
			write(reply);
		}
		data.pendingDeliveries -= 1;
		if (data.closeRequested && data.pendingDeliveries === 0) {
			// Emit the held 221 (and any companion replies) in protocol order,
			// then close.
			for (const reply of data.heldCloseReplies ?? []) {
				write(reply);
			}
			closeConn();
		}
	};

	// RFC 2033 §4.2: one reply per RCPT TO, in the order they were issued.
	// Dispatch in parallel, then render replies in RCPT order from the outcomes.
	const startDelivery = (delivery: {
		readonly recipients: ReadonlyArray<string>;
		readonly body: string;
	}): void => {
		data.pendingDeliveries += 1;
		const tasks = delivery.recipients.map((recipient) =>
			options.deliver(recipient, delivery.body),
		);
		void Promise.allSettled(tasks).then((results) =>
			finishDelivery(delivery.recipients, results),
		);
	};

	// QUIT received. If a delivery is mid-flight, defer the 221 + close until
	// the per-RCPT replies are flushed.
	const requestClose = (replies: ReadonlyArray<LmtpReply>): void => {
		if (data.pendingDeliveries > 0) {
			data.closeRequested = true;
			data.heldCloseReplies = replies;
		} else {
			closeConn();
		}
	};

	// Advance the state machine by one line; returns whether DATA mode is active
	const processLine = (line: string, inData: boolean): boolean => {
		const step = apply(
			data.state,
			parseCommand(line, inData),
			options.hostname,
			options.limits,
		);
		data.state = step.state;
		// QUIT's 221 reply is held back while a delivery is in flight so the
		// per-RCPT 250/5xx replies aren't sent AFTER the close acknowledgement
		// (which would make the upstream MTA distrust them).
		if (!(step.close === true && data.pendingDeliveries > 0)) {
			for (const reply of step.replies) {
				write(reply);
			}
		}
		if (step.delivery !== undefined) {
			startDelivery(step.delivery);
		}
		if (step.close === true) {
			requestClose(step.replies);
		}
		return step.state.tag === "Data";
	};

	const processText = (text: string): void => {
		let inData = data.state.tag === "Data";
		const { lines, tail } = splitLines(text, data.pending);
		data.pending = tail;
		for (const line of lines) {
			inData = processLine(line, inData);
		}
	};

	write(greeting(options.hostname));

	void options.runPromise(
		readSocket(conn, processText, () => closed).pipe(
			Effect.catch((error) =>
				Effect.logWarning("imip.lmtp: socket error", { error }),
			),
		),
	);
};
