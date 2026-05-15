/** biome-ignore-all lint/style/noMagicNumbers: SMTP/LMTP reply codes are protocol-defined */
// ---------------------------------------------------------------------------
// LMTP protocol state machine (RFC 2033). Pure — no I/O. The Bun.listen
// glue in `lmtp-server.ts` feeds bytes in, gets back command results +
// reply lines, and ships them to the socket / inbound processor.
//
// Supported verbs: LHLO, HELO/EHLO (accepted as alias), MAIL, RCPT, DATA,
// RSET, NOOP, QUIT. Multi-recipient delivery: after DATA terminates with
// `<CRLF>.<CRLF>`, the caller must emit one reply per RCPT TO (250 OK /
// 5xx) — that's the LMTP-vs-SMTP difference and matches what postfix /
// dovecot expect when speaking LMTP.
// ---------------------------------------------------------------------------

export type LmtpState =
	| { readonly tag: "Greet" }
	| { readonly tag: "Idle" }
	| {
			readonly tag: "Tx";
			readonly mailFrom: string;
			readonly recipients: ReadonlyArray<string>;
	  }
	| {
			readonly tag: "Data";
			readonly mailFrom: string;
			readonly recipients: ReadonlyArray<string>;
			readonly buffer: string;
	  };

export type LmtpCommand =
	| { readonly tag: "Lhlo"; readonly host: string }
	| { readonly tag: "MailFrom"; readonly addr: string }
	| { readonly tag: "RcptTo"; readonly addr: string }
	| { readonly tag: "DataStart" }
	| { readonly tag: "DataLine"; readonly line: string }
	| { readonly tag: "DataEnd" }
	| { readonly tag: "Rset" }
	| { readonly tag: "Noop" }
	| { readonly tag: "Quit" }
	| { readonly tag: "Bad"; readonly reason: string };

export interface LmtpReply {
	readonly code: number;
	readonly text: string;
}

const ok = (code: number, text: string): LmtpReply => ({ code, text });

const stripAddress = (raw: string): string | null => {
	const m = raw.match(/<([^>]*)>/);
	return m && m[1] !== undefined ? m[1].trim() : null;
};

export const parseCommand = (line: string, inData: boolean): LmtpCommand => {
	if (inData) {
		if (line === ".") {
			return { tag: "DataEnd" };
		}
		// RFC dot-stuffing: a leading `.` is doubled by the sender; we strip
		// the first.
		const unstuffed = line.startsWith("..") ? line.slice(1) : line;
		return { tag: "DataLine", line: unstuffed };
	}
	const upper = line.toUpperCase();
	if (
		upper.startsWith("LHLO ") ||
		upper.startsWith("EHLO ") ||
		upper.startsWith("HELO ")
	) {
		return { tag: "Lhlo", host: line.slice(5).trim() };
	}
	if (upper.startsWith("MAIL FROM:")) {
		const addr = stripAddress(line.slice("MAIL FROM:".length));
		return addr === null
			? { tag: "Bad", reason: "missing <address>" }
			: { tag: "MailFrom", addr };
	}
	if (upper.startsWith("RCPT TO:")) {
		const addr = stripAddress(line.slice("RCPT TO:".length));
		return addr === null
			? { tag: "Bad", reason: "missing <address>" }
			: { tag: "RcptTo", addr };
	}
	if (upper === "DATA") {
		return { tag: "DataStart" };
	}
	if (upper === "RSET") {
		return { tag: "Rset" };
	}
	if (upper === "NOOP") {
		return { tag: "Noop" };
	}
	if (upper === "QUIT") {
		return { tag: "Quit" };
	}
	return { tag: "Bad", reason: `unrecognised: ${upper.split(" ")[0]}` };
};

// Returns the new state plus reply lines to send. For DATA termination the
// caller is responsible for invoking the inbound processor and emitting one
// 250 (or error) per recipient — `apply` only signals "delivery starts now"
// via the second tuple field `data` carrying the buffered message body.
export interface LmtpStep {
	readonly state: LmtpState;
	readonly replies: ReadonlyArray<LmtpReply>;
	/**
	 * Set when DATA finished. The caller must emit one reply line per
	 * recipient (in original order) after processing.
	 */
	readonly delivery?: {
		readonly mailFrom: string;
		readonly recipients: ReadonlyArray<string>;
		readonly body: string;
	};
	readonly close?: boolean;
}

export const initialState: LmtpState = { tag: "Greet" };

export const greeting = (hostname: string): LmtpReply =>
	ok(220, `${hostname} shuriken LMTP ready`);

export const apply = (
	state: LmtpState,
	cmd: LmtpCommand,
	hostname: string,
): LmtpStep => {
	if (cmd.tag === "Quit") {
		return {
			state,
			replies: [ok(221, `${hostname} closing connection`)],
			close: true,
		};
	}
	if (cmd.tag === "Noop") {
		return { state, replies: [ok(250, "OK")] };
	}
	if (cmd.tag === "Rset") {
		return { state: { tag: "Idle" }, replies: [ok(250, "OK")] };
	}
	if (cmd.tag === "Bad") {
		return { state, replies: [ok(500, `Bad command: ${cmd.reason}`)] };
	}
	if (cmd.tag === "Lhlo") {
		return {
			state: { tag: "Idle" },
			replies: [ok(250, `${hostname} hello ${cmd.host}`)],
		};
	}
	if (cmd.tag === "MailFrom") {
		return {
			state: { tag: "Tx", mailFrom: cmd.addr, recipients: [] },
			replies: [ok(250, "OK")],
		};
	}
	if (cmd.tag === "RcptTo") {
		if (state.tag !== "Tx") {
			return { state, replies: [ok(503, "MAIL FROM first")] };
		}
		return {
			state: { ...state, recipients: [...state.recipients, cmd.addr] },
			replies: [ok(250, "OK")],
		};
	}
	if (cmd.tag === "DataStart") {
		if (state.tag !== "Tx" || state.recipients.length === 0) {
			return { state, replies: [ok(503, "RCPT TO first")] };
		}
		return {
			state: {
				tag: "Data",
				mailFrom: state.mailFrom,
				recipients: state.recipients,
				buffer: "",
			},
			replies: [ok(354, "End data with <CR><LF>.<CR><LF>")],
		};
	}
	if (cmd.tag === "DataLine") {
		if (state.tag !== "Data") {
			return { state, replies: [ok(503, "DATA first")] };
		}
		return {
			state: { ...state, buffer: `${state.buffer}${cmd.line}\r\n` },
			replies: [],
		};
	}
	// cmd.tag === "DataEnd"
	if (state.tag !== "Data") {
		return { state, replies: [ok(503, "DATA first")] };
	}
	return {
		state: { tag: "Idle" },
		replies: [],
		delivery: {
			mailFrom: state.mailFrom,
			recipients: state.recipients,
			body: state.buffer,
		},
	};
};

export const formatReply = (reply: LmtpReply): string =>
	`${reply.code} ${reply.text}\r\n`;
