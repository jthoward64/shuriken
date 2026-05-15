import { describe, expect, it } from "bun:test";
import {
	apply,
	formatReply,
	greeting,
	initialState,
	parseCommand,
} from "./lmtp-protocol.ts";

describe("LMTP protocol", () => {
	it("greeting is 220", () => {
		expect(greeting("h").code).toBe(220);
	});

	it("LHLO transitions to Idle and replies 250", () => {
		const cmd = parseCommand("LHLO client.example", false);
		const step = apply(initialState, cmd, "shuriken");
		expect(step.state.tag).toBe("Idle");
		expect(step.replies[0]?.code).toBe(250);
	});

	it("MAIL FROM / RCPT TO / DATA produces a delivery", () => {
		let state = initialState;
		state = apply(state, parseCommand("LHLO c", false), "h").state;
		state = apply(state, parseCommand("MAIL FROM:<a@x>", false), "h").state;
		state = apply(state, parseCommand("RCPT TO:<r1@y>", false), "h").state;
		state = apply(state, parseCommand("RCPT TO:<r2@y>", false), "h").state;
		state = apply(state, parseCommand("DATA", false), "h").state;
		state = apply(state, parseCommand("Subject: hi", true), "h").state;
		state = apply(state, parseCommand("", true), "h").state;
		state = apply(state, parseCommand("body line", true), "h").state;
		const final = apply(state, parseCommand(".", true), "h");
		expect(final.delivery).toBeDefined();
		expect(final.delivery?.recipients).toEqual(["r1@y", "r2@y"]);
		expect(final.delivery?.body).toContain("body line");
		expect(final.state.tag).toBe("Idle");
	});

	it("rejects RCPT TO before MAIL FROM", () => {
		const lhlo = apply(initialState, parseCommand("LHLO c", false), "h");
		const bad = apply(lhlo.state, parseCommand("RCPT TO:<r@y>", false), "h");
		expect(bad.replies[0]?.code).toBe(503);
	});

	it("dot-stuffing strips a leading dot in DATA", () => {
		const cmd = parseCommand("..hidden", true);
		expect(cmd.tag).toBe("DataLine");
		if (cmd.tag === "DataLine") {
			expect(cmd.line).toBe(".hidden");
		}
	});

	it("formatReply ends with CRLF", () => {
		expect(formatReply({ code: 250, text: "OK" })).toBe("250 OK\r\n");
	});
});
