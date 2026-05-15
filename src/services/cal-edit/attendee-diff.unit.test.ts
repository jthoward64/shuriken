import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { buildVeventComponent } from "#src/services/cal-edit/build-vevent.ts";
import { parseVeventToForm } from "#src/services/cal-edit/parse-vevent.ts";
import { emptyEventForm } from "#src/services/cal-edit/types.ts";
import { extractAttendeeAddresses } from "#src/services/imip/build-message.ts";

// ---------------------------------------------------------------------------
// Verifies the form-owned semantics for ATTENDEE / ORGANIZER:
//   * On rebuild, the IR's attendee list matches the form authoritatively.
//   * A "removed attendee" diff yields exactly the dropped addresses so the
//     UI can fire CANCEL to them.
//
// Regression test for two related bugs: edit-merge was preserving old
// ATTENDEE properties (leading to duplicates) and the UI never told
// removed attendees the event was cancelled.
// ---------------------------------------------------------------------------

const veventFromForm = (form: Parameters<typeof buildVeventComponent>[1]) => {
	const v = buildVeventComponent("uid", form);
	if (!v) {
		throw new Error("buildVeventComponent returned null");
	}
	return v;
};

describe("attendee diff", () => {
	it("buildVeventComponent emits exactly the form's attendees", () => {
		const v = veventFromForm({
			...emptyEventForm,
			summary: "X",
			start: "2026-06-01T10:00",
			attendees: ["a@x", "b@x"],
		});
		const addrs = v.properties
			.filter((p) => p.name === "ATTENDEE")
			.map((p) => (p.value.type === "CAL_ADDRESS" ? p.value.value : ""));
		expect(addrs).toEqual(["mailto:a@x", "mailto:b@x"]);
	});

	it("parse → modify → build drops removed attendees (round-trip)", () => {
		const original = veventFromForm({
			...emptyEventForm,
			summary: "X",
			start: "2026-06-01T10:00",
			attendees: ["a@x", "b@x", "c@x"],
		});
		const parsed = parseVeventToForm(original);
		expect(parsed.attendees).toEqual(["a@x", "b@x", "c@x"]);
		const updated = veventFromForm({ ...parsed, attendees: ["a@x"] });
		const reparsed = parseVeventToForm(updated);
		expect(reparsed.attendees).toEqual(["a@x"]);
	});

	it("compute removed = old − new", () => {
		const oldVevent = veventFromForm({
			...emptyEventForm,
			summary: "X",
			start: "2026-06-01T10:00",
			attendees: ["alice@x", "bob@x", "carol@x"],
		});
		const oldAddrs = extractAttendeeAddresses(oldVevent);
		const newSet = new Set(["alice@x"]);
		const removed = oldAddrs.filter((a) => !newSet.has(a.toLowerCase()));
		expect(removed.sort()).toEqual(["bob@x", "carol@x"]);
	});

	it("extractAttendeeAddresses tolerates an empty VEVENT", async () => {
		await Effect.runPromise(Effect.succeed(undefined));
		expect(
			extractAttendeeAddresses({
				name: "VEVENT",
				properties: [],
				components: [],
			}),
		).toEqual([]);
	});
});
