import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import {
	apply,
	deliveryReply,
	formatReply,
	greeting,
	initialState,
	parseCommand,
	renderDeliveryReplies,
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

	it("deliveryReply maps every outcome variant", () => {
		expect(deliveryReply("a@x", { tag: "Applied" })).toEqual({
			code: 250,
			text: "Delivered a@x",
		});
		expect(deliveryReply("a@x", { tag: "UnknownRecipient" })).toEqual({
			code: 550,
			text: "No such user: a@x",
		});
		expect(deliveryReply("a@x", { tag: "MissingCalendar" })).toEqual({
			code: 550,
			text: "No primary calendar for a@x",
		});
		expect(deliveryReply("a@x", { tag: "NotImip" })).toEqual({
			code: 550,
			text: "Not an iMIP message",
		});
		expect(
			deliveryReply("a@x", { tag: "MalformedIcs", cause: "no METHOD" }),
		).toEqual({
			code: 550,
			text: "Malformed iCalendar: no METHOD",
		});
		expect(deliveryReply("a@x", { tag: "Rejected" })).toEqual({
			code: 451,
			text: "Temporary failure",
		});
	});

	it("renderDeliveryReplies preserves RCPT order (RFC 2033 §4.2)", () => {
		// Outcomes intentionally not in RCPT order — caller may resolve them
		// out of completion order via Promise.allSettled; the renderer must
		// re-align with the RCPT list.
		const rcpts = ["alice@x", "bob@x", "carol@x"];
		const outcomes = [
			{ tag: "Applied" } as const,
			{ tag: "UnknownRecipient" } as const,
			{ tag: "Applied" } as const,
		];
		const replies = renderDeliveryReplies(rcpts, outcomes);
		expect(replies.map((r) => r.text)).toEqual([
			"Delivered alice@x",
			"No such user: bob@x",
			"Delivered carol@x",
		]);
	});

	it("renderDeliveryReplies fills missing outcomes with Rejected", () => {
		// Defensive — if a Promise didn't settle for some reason the recipient
		// still gets a deterministic reply (451) rather than no reply at all,
		// which would hang the upstream MTA.
		const replies = renderDeliveryReplies(["a@x", "b@x"], [{ tag: "Applied" }]);
		expect(replies[1]).toEqual({ code: 451, text: "Temporary failure" });
	});
});
