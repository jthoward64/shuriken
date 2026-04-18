// ---------------------------------------------------------------------------
// SchedulingService — live implementation (RFC 6638)
//
// Handles implicit scheduling:
//   - SOR detection (ORGANIZER + ATTENDEE present)
//   - iTIP REQUEST delivery to on-server attendees (organizer PUT)
//   - iTIP REPLY delivery to organizer inbox (attendee PARTSTAT change)
//   - iTIP CANCEL delivery to attendees (organizer DELETE)
//   - Attendee REPLY DECLINED delivery (attendee DELETE with RSVP=TRUE)
//   - Attendee-only change validation
//   - Outbox POST free-busy aggregation (RFC 6638 §5)
//   - iMIP pending row insertion for external (off-server) attendees
// ---------------------------------------------------------------------------

import { Effect, Layer, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import { makeEtag } from "#src/data/etag.ts";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import {
	buildVfreebusyText,
	coalescePeriods,
	deriveFbType,
	type Period,
} from "#src/data/icalendar/freebusy.ts";
import {
	effectiveDtend,
	getDtstartInstant,
} from "#src/data/icalendar/ir-helpers.ts";
import { getOccurrenceInstantsInRange } from "#src/data/icalendar/recurrence/recurrence-check.ts";
import type { IrComponent, IrDocument, IrProperty } from "#src/data/ir.ts";
import { forbidden } from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import { CollectionId, EntityId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { ETag } from "#src/domain/types/strings.ts";
import { AclService } from "#src/services/acl/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { PrincipalRepository } from "#src/services/principal/index.ts";
import { SchedulingRepository } from "./repository.ts";
import { SchedulingService } from "./service.ts";
import type { AttendeeInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SCHEDULE-STATUS codes per RFC 6638 §9.6 */
const SCHED_STATUS_DELIVERED = "2.0";
const SCHED_STATUS_PENDING = "1.2";
const SCHED_STATUS_FAILED = "5.1";

/** Properties attendees are allowed to modify (RFC 6638 §3.2.2.1) */
const ATTENDEE_MUTABLE_PROPS = new Set([
	"TRANSP",
	"VALARM",
	"DTSTAMP",
	"LAST-MODIFIED",
	"SEQUENCE",
	"ATTENDEE", // PARTSTAT changes are on the ATTENDEE property itself
]);

// ---------------------------------------------------------------------------
// SOR detection helpers (pure functions — no Effect)
// ---------------------------------------------------------------------------

const isSor = (doc: IrDocument): boolean => {
	if (doc.kind !== "icalendar") {
		return false;
	}
	for (const comp of doc.root.components) {
		if (comp.name !== "VEVENT" && comp.name !== "VTODO") {
			continue;
		}
		const hasOrganizer = comp.properties.some((p) => p.name === "ORGANIZER");
		const hasAttendee = comp.properties.some((p) => p.name === "ATTENDEE");
		if (hasOrganizer && hasAttendee) {
			return true;
		}
	}
	return false;
};

const extractOrganizerCalAddress = (doc: IrDocument): string | undefined => {
	if (doc.kind !== "icalendar") {
		return undefined;
	}
	for (const comp of doc.root.components) {
		if (comp.name !== "VEVENT" && comp.name !== "VTODO") {
			continue;
		}
		const prop = comp.properties.find((p) => p.name === "ORGANIZER");
		if (prop?.value.type === "CAL_ADDRESS") {
			return prop.value.value;
		}
	}
	return undefined;
};

const extractSorUid = (doc: IrDocument): string | undefined => {
	if (doc.kind !== "icalendar") {
		return undefined;
	}
	for (const comp of doc.root.components) {
		if (comp.name !== "VEVENT" && comp.name !== "VTODO") {
			continue;
		}
		const prop = comp.properties.find((p) => p.name === "UID");
		if (prop?.value.type === "TEXT") {
			return prop.value.value;
		}
	}
	return undefined;
};

const extractAttendees = (doc: IrDocument): ReadonlyArray<AttendeeInfo> => {
	if (doc.kind !== "icalendar") {
		return [];
	}
	const seen = new Set<string>();
	const result: Array<AttendeeInfo> = [];
	for (const comp of doc.root.components) {
		if (comp.name !== "VEVENT" && comp.name !== "VTODO") {
			continue;
		}
		for (const prop of comp.properties) {
			if (prop.name !== "ATTENDEE" || prop.value.type !== "CAL_ADDRESS") {
				continue;
			}
			const calAddress = prop.value.value;
			if (seen.has(calAddress.toLowerCase())) {
				continue;
			}
			seen.add(calAddress.toLowerCase());
			const agentParam = prop.parameters.find(
				(pa) => pa.name === "SCHEDULE-AGENT",
			);
			const scheduleAgent: AttendeeInfo["scheduleAgent"] =
				agentParam?.value === "CLIENT"
					? "CLIENT"
					: agentParam?.value === "NONE"
						? "NONE"
						: "SERVER";
			const rsvpParam = prop.parameters.find((pa) => pa.name === "RSVP");
			const rsvp = rsvpParam?.value?.toUpperCase() === "TRUE";
			const partstatParam = prop.parameters.find(
				(pa) => pa.name === "PARTSTAT",
			);
			const partstat = partstatParam?.value ?? "NEEDS-ACTION";
			result.push({ calAddress, scheduleAgent, rsvp, partstat });
		}
	}
	return result;
};

// ---------------------------------------------------------------------------
// iTIP message builders (pure — no Effect)
// ---------------------------------------------------------------------------

const makeDtstampProp = (): IrProperty => ({
	name: "DTSTAMP",
	parameters: [],
	value: { type: "DATE_TIME", value: Temporal.Now.zonedDateTimeISO("UTC") },
	isKnown: true,
});

const buildItipRequest = (doc: IrDocument): IrDocument => {
	if (doc.kind !== "icalendar") {
		return doc;
	}
	const vcalProps = doc.root.properties.filter((p) => p.name !== "METHOD");
	const components = doc.root.components.map((comp) => {
		if (comp.name !== "VEVENT" && comp.name !== "VTODO") {
			return comp;
		}
		return {
			...comp,
			properties: comp.properties.map((p) => {
				if (p.name !== "ATTENDEE") {
					return p;
				}
				return {
					...p,
					parameters: p.parameters.filter(
						(pa) => pa.name !== "SCHEDULE-STATUS",
					),
				};
			}),
		};
	});
	return {
		kind: "icalendar",
		root: {
			name: "VCALENDAR",
			properties: [
				{
					name: "METHOD",
					parameters: [],
					value: { type: "TEXT", value: "REQUEST" },
					isKnown: true,
				},
				...vcalProps,
			],
			components,
		},
	};
};

const buildItipCancel = (doc: IrDocument): IrDocument => {
	if (doc.kind !== "icalendar") {
		return doc;
	}
	const vcalProps = doc.root.properties.filter((p) => p.name !== "METHOD");
	const components = doc.root.components.map((comp) => {
		if (comp.name !== "VEVENT" && comp.name !== "VTODO") {
			return comp;
		}
		const seqProp = comp.properties.find((p) => p.name === "SEQUENCE");
		const seqValue =
			seqProp?.value.type === "INTEGER" ? seqProp.value.value : 0;
		const baseProps = comp.properties.filter(
			(p) => p.name !== "SEQUENCE" && p.name !== "STATUS",
		);
		const updatedSeq: IrProperty = {
			name: "SEQUENCE",
			parameters: [],
			value: { type: "INTEGER", value: seqValue + 1 },
			isKnown: true,
		};
		const cancelStatus: IrProperty = {
			name: "STATUS",
			parameters: [],
			value: { type: "TEXT", value: "CANCELLED" },
			isKnown: true,
		};
		return { ...comp, properties: [...baseProps, updatedSeq, cancelStatus] };
	});
	return {
		kind: "icalendar",
		root: {
			name: "VCALENDAR",
			properties: [
				{
					name: "METHOD",
					parameters: [],
					value: { type: "TEXT", value: "CANCEL" },
					isKnown: true,
				},
				...vcalProps,
			],
			components,
		},
	};
};

const buildItipReply = (
	doc: IrDocument,
	replyingCalAddress: string,
): IrDocument => {
	if (doc.kind !== "icalendar") {
		return doc;
	}
	const vcalProps = doc.root.properties.filter((p) => p.name !== "METHOD");
	const components = doc.root.components.map((comp) => {
		if (comp.name !== "VEVENT" && comp.name !== "VTODO") {
			return comp;
		}
		const filteredProps = comp.properties.filter((p) => {
			if (p.name !== "ATTENDEE") {
				return true;
			}
			if (p.value.type !== "CAL_ADDRESS") {
				return false;
			}
			return p.value.value.toLowerCase() === replyingCalAddress.toLowerCase();
		});
		return {
			...comp,
			properties: filteredProps.map((p) =>
				p.name === "DTSTAMP" ? makeDtstampProp() : p,
			),
		};
	});
	return {
		kind: "icalendar",
		root: {
			name: "VCALENDAR",
			properties: [
				{
					name: "METHOD",
					parameters: [],
					value: { type: "TEXT", value: "REPLY" },
					isKnown: true,
				},
				...vcalProps,
			],
			components,
		},
	};
};

const patchPartstat = (doc: IrDocument, partstat: string): IrDocument => {
	if (doc.kind !== "icalendar") {
		return doc;
	}
	return {
		...doc,
		root: {
			...doc.root,
			components: doc.root.components.map((comp) => {
				if (comp.name !== "VEVENT" && comp.name !== "VTODO") {
					return comp;
				}
				return {
					...comp,
					properties: comp.properties.map((p) => {
						if (p.name !== "ATTENDEE") {
							return p;
						}
						return {
							...p,
							parameters: [
								...p.parameters.filter((pa) => pa.name !== "PARTSTAT"),
								{ name: "PARTSTAT", value: partstat },
							],
						};
					}),
				};
			}),
		},
	};
};

/** Mutate SCHEDULE-STATUS param on the ATTENDEE for a given cal-address. */
const applyScheduleStatus = (
	root: IrComponent,
	calAddress: string,
	status: string,
): IrComponent => ({
	...root,
	components: root.components.map((comp) => {
		if (comp.name !== "VEVENT" && comp.name !== "VTODO") {
			return comp;
		}
		return {
			...comp,
			properties: comp.properties.map((p) => {
				if (p.name !== "ATTENDEE" || p.value.type !== "CAL_ADDRESS") {
					return p;
				}
				if (p.value.value.toLowerCase() !== calAddress.toLowerCase()) {
					return p;
				}
				return {
					...p,
					parameters: [
						...p.parameters.filter((pa) => pa.name !== "SCHEDULE-STATUS"),
						{ name: "SCHEDULE-STATUS", value: status },
					],
				};
			}),
		};
	}),
});

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const SchedulingServiceLive = Layer.effect(
	SchedulingService,
	Effect.gen(function* () {
		const repo = yield* SchedulingRepository;
		const principalRepo = yield* PrincipalRepository;
		const componentRepo = yield* ComponentRepository;
		const entityRepo = yield* EntityRepository;
		const instanceSvc = yield* InstanceService;
		const aclSvc = yield* AclService;

		// -------------------------------------------------------------------------
		// Helper: write updated SCHEDULE-STATUS params back to the stored tree
		// -------------------------------------------------------------------------

		const persistScheduleStatus = Effect.fn(
			"SchedulingService.persistScheduleStatus",
		)(function* (entityId: EntityId, calAddress: string, status: string) {
			const treeOpt = yield* componentRepo.loadTree(entityId, "icalendar");
			if (Option.isNone(treeOpt)) {
				return;
			}
			const updated = applyScheduleStatus(treeOpt.value, calAddress, status);
			yield* componentRepo.deleteByEntity(entityId);
			yield* componentRepo.insertTree(entityId, updated);
		});

		// -------------------------------------------------------------------------
		// Helper: write one iTIP document into a collection as a new instance
		// -------------------------------------------------------------------------

		const persistItipToCollection = Effect.fn(
			"SchedulingService.persistItipToCollection",
		)(function* (collectionId: CollectionId, itipDoc: IrDocument, uid: string) {
			const canonical = yield* encodeICalendar(itipDoc);
			const etag = ETag(yield* makeEtag(canonical));
			const contentLength = new TextEncoder().encode(canonical).byteLength;
			const slug = Slug(`${uid}-${crypto.randomUUID()}.ics`);
			const entityRow = yield* entityRepo.insert({
				entityType: "icalendar",
				logicalUid: uid,
			});
			yield* componentRepo.insertTree(EntityId(entityRow.id), itipDoc.root);
			yield* instanceSvc.put({
				collectionId,
				entityId: EntityId(entityRow.id),
				contentType: "text/calendar",
				etag,
				slug,
				contentLength,
			});
		});

		// -------------------------------------------------------------------------
		// Helper: deliver an iTIP doc to a principal's inbox (+ auto-placement copy)
		// -------------------------------------------------------------------------

		const deliverToInbox = Effect.fn("SchedulingService.deliverToInbox")(
			function* (
				recipientPrincipalId: PrincipalId,
				itipDoc: IrDocument,
				uid: string,
			) {
				const inboxOpt = yield* repo.findInbox(recipientPrincipalId);
				if (Option.isNone(inboxOpt)) {
					yield* Effect.logWarning(
						"scheduling.deliverToInbox: no inbox found",
						{ recipientPrincipalId },
					);
					return false;
				}
				const inboxId = CollectionId(inboxOpt.value.id);

				// Check schedule-deliver-invite privilege (best-effort — don't block)
				yield* Effect.ignore(
					aclSvc.check(
						recipientPrincipalId,
						inboxId,
						"collection",
						"CALDAV:schedule-deliver-invite",
					),
				);

				yield* persistItipToCollection(inboxId, itipDoc, uid);

				// Auto-placement copy into schedule-default-calendar (RFC 6638 §3.4.2)
				const defaultCalOpt =
					yield* repo.findDefaultCalendar(recipientPrincipalId);
				if (Option.isSome(defaultCalOpt)) {
					yield* Effect.ignore(
						persistItipToCollection(
							CollectionId(defaultCalOpt.value.id),
							patchPartstat(itipDoc, "NEEDS-ACTION"),
							uid,
						),
					);
				}
				return true;
			},
		);

		// -------------------------------------------------------------------------
		// Helper: look up acting principal's own cal-address ("mailto:email")
		// -------------------------------------------------------------------------

		const actingCalAddress = Effect.fn("SchedulingService.actingCalAddress")(
			function* (principalId: PrincipalId) {
				const pwuOpt = yield* principalRepo.findById(principalId);
				return Option.map(pwuOpt, (pwu) => `mailto:${pwu.user.email}`);
			},
		);

		// -------------------------------------------------------------------------
		// Helper: determine role vs organizer cal-address
		// -------------------------------------------------------------------------

		const determineRole = Effect.fn("SchedulingService.determineRole")(
			function* (principalId: PrincipalId, organizerCalAddress: string) {
				const addrOpt = yield* actingCalAddress(principalId);
				if (Option.isNone(addrOpt)) {
					return "unrelated" as const;
				}
				const addr = addrOpt.value.toLowerCase();
				const orgNorm = organizerCalAddress.toLowerCase();
				return addr === orgNorm
					? ("organizer" as const)
					: ("attendee" as const);
			},
		);

		// =========================================================================
		// processAfterPut
		// =========================================================================

		const processAfterPut = Effect.fn("SchedulingService.processAfterPut")(
			function* (opts: {
				actingPrincipalId: PrincipalId;
				entityId: EntityId;
				instanceId: import("#src/domain/ids.ts").InstanceId;
				collectionId: CollectionId;
				doc: IrDocument;
				previousDoc: Option.Option<IrDocument>;
				suppressReply: boolean;
			}) {
				const {
					actingPrincipalId,
					entityId,
					instanceId,
					doc,
					previousDoc,
					suppressReply,
				} = opts;

				if (!isSor(doc)) {
					return Option.none<string>();
				}

				const organizerCalAddress = extractOrganizerCalAddress(doc);
				if (!organizerCalAddress) {
					return Option.none<string>();
				}
				const uid = extractSorUid(doc);
				if (!uid) {
					return Option.none<string>();
				}

				const role = yield* determineRole(
					actingPrincipalId,
					organizerCalAddress,
				);
				const scheduleTag = crypto.randomUUID();

				const serverAttendees = extractAttendees(doc).filter(
					(a) => a.scheduleAgent === "SERVER",
				);

				if (role === "organizer") {
					const prevAttendees = Option.isSome(previousDoc)
						? extractAttendees(previousDoc.value).filter(
								(a) => a.scheduleAgent === "SERVER",
							)
						: [];
					const currAddresses = new Set(
						serverAttendees.map((a) => a.calAddress.toLowerCase()),
					);
					const removedAttendees = prevAttendees.filter(
						(a) => !currAddresses.has(a.calAddress.toLowerCase()),
					);

					const requestDoc = buildItipRequest(doc);

					for (const attendee of serverAttendees) {
						const recipientOpt = yield* repo.findPrincipalByCalAddress(
							attendee.calAddress,
						);
						if (Option.isSome(recipientOpt)) {
							const delivered = yield* deliverToInbox(
								recipientOpt.value.principal.id as PrincipalId,
								requestDoc,
								uid,
							).pipe(
								Effect.catchAll((e) =>
									Effect.logWarning(
										"scheduling.processAfterPut: delivery failed",
										{ attendee: attendee.calAddress, cause: e },
									).pipe(Effect.as(false)),
								),
							);
							yield* Effect.ignore(
								persistScheduleStatus(
									entityId,
									attendee.calAddress,
									delivered ? SCHED_STATUS_DELIVERED : SCHED_STATUS_FAILED,
								),
							);
						} else {
							// External attendee — record iMIP pending row
							const inboxOpt = yield* repo.findInbox(actingPrincipalId);
							if (Option.isSome(inboxOpt)) {
								yield* Effect.ignore(
									repo.insertScheduleMessage({
										collectionId: CollectionId(inboxOpt.value.id),
										entityId,
										sender: organizerCalAddress,
										recipient: attendee.calAddress,
										method: "REQUEST",
									}),
								);
							}
							yield* Effect.ignore(
								persistScheduleStatus(
									entityId,
									attendee.calAddress,
									SCHED_STATUS_PENDING,
								),
							);
						}
					}

					if (removedAttendees.length > 0) {
						const cancelDoc = buildItipCancel(
							Option.isSome(previousDoc) ? previousDoc.value : doc,
						);
						for (const removed of removedAttendees) {
							const recipientOpt = yield* repo.findPrincipalByCalAddress(
								removed.calAddress,
							);
							if (Option.isSome(recipientOpt)) {
								yield* Effect.ignore(
									deliverToInbox(
										recipientOpt.value.principal.id as PrincipalId,
										cancelDoc,
										uid,
									),
								);
							}
						}
					}
				} else if (role === "attendee" && !suppressReply) {
					const myAddrOpt = yield* actingCalAddress(actingPrincipalId);
					if (Option.isNone(myAddrOpt)) {
						return Option.some(scheduleTag);
					}

					const myAddr = myAddrOpt.value;
					const currPartstat =
						serverAttendees.find(
							(a) => a.calAddress.toLowerCase() === myAddr.toLowerCase(),
						)?.partstat ?? "NEEDS-ACTION";
					const prevPartstat = Option.isSome(previousDoc)
						? extractAttendees(previousDoc.value).find(
								(a) => a.calAddress.toLowerCase() === myAddr.toLowerCase(),
							)?.partstat
						: undefined;

					if (prevPartstat !== currPartstat || Option.isNone(previousDoc)) {
						const replyDoc = buildItipReply(doc, myAddr);
						const organizerOpt =
							yield* repo.findPrincipalByCalAddress(organizerCalAddress);
						if (Option.isSome(organizerOpt)) {
							yield* Effect.ignore(
								deliverToInbox(
									organizerOpt.value.principal.id as PrincipalId,
									replyDoc,
									uid,
								),
							);
						} else {
							// External organizer — iMIP
							const inboxOpt = yield* repo.findInbox(actingPrincipalId);
							if (Option.isSome(inboxOpt)) {
								yield* Effect.ignore(
									repo.insertScheduleMessage({
										collectionId: CollectionId(inboxOpt.value.id),
										entityId,
										sender: myAddr,
										recipient: organizerCalAddress,
										method: "REPLY",
									}),
								);
							}
						}
					}
				}

				yield* Effect.ignore(repo.updateScheduleTag(instanceId, scheduleTag));
				return Option.some(scheduleTag);
			},
		);

		// =========================================================================
		// validateSchedulingChange
		// =========================================================================

		const validateSchedulingChange = Effect.fn(
			"SchedulingService.validateSchedulingChange",
		)(function* (opts: {
			actingPrincipalId: PrincipalId;
			oldDoc: IrDocument;
			newDoc: IrDocument;
		}) {
			const { actingPrincipalId, oldDoc, newDoc } = opts;

			if (!isSor(oldDoc) && !isSor(newDoc)) {
				return;
			}

			const organizerCalAddress =
				extractOrganizerCalAddress(newDoc) ??
				extractOrganizerCalAddress(oldDoc);
			if (!organizerCalAddress) {
				return;
			}

			// same-organizer-in-all-components (RFC 6638 §3.2.4.2)
			if (newDoc.kind === "icalendar") {
				const organizers = new Set(
					newDoc.root.components
						.filter((c) => c.name === "VEVENT" || c.name === "VTODO")
						.flatMap((c) => {
							const p = c.properties.find((pp) => pp.name === "ORGANIZER");
							return p?.value.type === "CAL_ADDRESS"
								? [p.value.value.toLowerCase()]
								: [];
						}),
				);
				if (organizers.size > 1) {
					yield* forbidden("CALDAV:same-organizer-in-all-components");
					return;
				}
				if (
					organizers.size === 1 &&
					!organizers.has(organizerCalAddress.toLowerCase())
				) {
					yield* forbidden("CALDAV:same-organizer-in-all-components");
					return;
				}
			}

			const role = yield* determineRole(actingPrincipalId, organizerCalAddress);
			if (role !== "attendee") {
				return;
			}

			// Attendee-only change validation (RFC 6638 §3.2.2.1)
			if (oldDoc.kind !== "icalendar" || newDoc.kind !== "icalendar") {
				return;
			}

			for (let i = 0; i < newDoc.root.components.length; i++) {
				const newComp = newDoc.root.components[i];
				const oldComp = oldDoc.root.components[i];
				if (!newComp || !oldComp) {
					continue;
				}
				if (newComp.name !== "VEVENT" && newComp.name !== "VTODO") {
					continue;
				}

				for (const prop of newComp.properties) {
					if (ATTENDEE_MUTABLE_PROPS.has(prop.name)) {
						continue;
					}
					const oldProp = oldComp.properties.find((p) => p.name === prop.name);
					if (JSON.stringify(prop.value) !== JSON.stringify(oldProp?.value)) {
						yield* forbidden(
							"CALDAV:allowed-attendee-scheduling-object-change",
						);
						return;
					}
				}
			}
		});

		// =========================================================================
		// processAfterDelete
		// =========================================================================

		const processAfterDelete = Effect.fn(
			"SchedulingService.processAfterDelete",
		)(function* (opts: {
			actingPrincipalId: PrincipalId;
			doc: IrDocument;
			suppressReply: boolean;
		}) {
			const { actingPrincipalId, doc, suppressReply } = opts;

			if (!isSor(doc)) {
				return;
			}
			const organizerCalAddress = extractOrganizerCalAddress(doc);
			if (!organizerCalAddress) {
				return;
			}
			const uid = extractSorUid(doc);
			if (!uid) {
				return;
			}

			const role = yield* determineRole(actingPrincipalId, organizerCalAddress);

			if (role === "organizer") {
				const cancelDoc = buildItipCancel(doc);
				const serverAttendees = extractAttendees(doc).filter(
					(a) => a.scheduleAgent === "SERVER",
				);
				for (const attendee of serverAttendees) {
					const recipientOpt = yield* repo.findPrincipalByCalAddress(
						attendee.calAddress,
					);
					if (Option.isSome(recipientOpt)) {
						yield* Effect.ignore(
							deliverToInbox(
								recipientOpt.value.principal.id as PrincipalId,
								cancelDoc,
								uid,
							),
						);
					}
				}
			} else if (role === "attendee" && !suppressReply) {
				const myAddrOpt = yield* actingCalAddress(actingPrincipalId);
				if (Option.isNone(myAddrOpt)) {
					return;
				}

				const myAddr = myAddrOpt.value;
				const attendeeInfo = extractAttendees(doc).find(
					(a) => a.calAddress.toLowerCase() === myAddr.toLowerCase(),
				);
				if (!attendeeInfo?.rsvp) {
					return;
				}

				const replyDoc = buildItipReply(patchPartstat(doc, "DECLINED"), myAddr);
				const organizerOpt =
					yield* repo.findPrincipalByCalAddress(organizerCalAddress);
				if (Option.isSome(organizerOpt)) {
					yield* Effect.ignore(
						deliverToInbox(
							organizerOpt.value.principal.id as PrincipalId,
							replyDoc,
							uid,
						),
					);
				}
			}
		});

		// =========================================================================
		// processOutboxPost
		// =========================================================================

		const processOutboxPost = Effect.fn("SchedulingService.processOutboxPost")(
			function* (opts: { actingPrincipalId: PrincipalId; doc: IrDocument }) {
				const { doc } = opts;

				if (doc.kind !== "icalendar") {
					return yield* Effect.fail(
						forbidden("CALDAV:valid-scheduling-message", "Expected iCalendar"),
					);
				}

				const vfb = doc.root.components.find((c) => c.name === "VFREEBUSY");
				if (!vfb) {
					return yield* Effect.fail(
						forbidden(
							"CALDAV:valid-scheduling-message",
							"No VFREEBUSY component",
						),
					);
				}

				const dtstartProp = vfb.properties.find((p) => p.name === "DTSTART");
				const dtendProp = vfb.properties.find((p) => p.name === "DTEND");
				if (
					!dtstartProp ||
					!dtendProp ||
					dtstartProp.value.type !== "DATE_TIME" ||
					dtendProp.value.type !== "DATE_TIME"
				) {
					return yield* Effect.fail(
						forbidden(
							"CALDAV:valid-scheduling-message",
							"VFREEBUSY requires UTC DTSTART and DTEND",
						),
					);
				}

				const queryStart = dtstartProp.value.value.toInstant();
				const queryEnd = dtendProp.value.value.toInstant();

				const attendeeAddresses = vfb.properties
					.filter(
						(p) => p.name === "ATTENDEE" && p.value.type === "CAL_ADDRESS",
					)
					.map((p) => p.value.value as string);

				const periods: Array<Period> = [];

				for (const calAddress of attendeeAddresses) {
					const pwuOpt = yield* repo.findPrincipalByCalAddress(calAddress);
					if (Option.isNone(pwuOpt)) {
						continue;
					}

					const recipientId = pwuOpt.value.principal.id as PrincipalId;
					const collections =
						yield* repo.listOpaqueCalendarCollections(recipientId);

					for (const coll of collections) {
						const instances = yield* instanceSvc.listByCollection(
							CollectionId(coll.id),
						);
						for (const inst of instances) {
							const treeOpt = yield* componentRepo.loadTree(
								EntityId(inst.entityId),
								"icalendar",
							);
							if (Option.isNone(treeOpt)) {
								continue;
							}
							const root = treeOpt.value;

							for (const comp of root.components) {
								if (comp.name !== "VEVENT") {
									continue;
								}
								const fbType = deriveFbType(comp);
								if (fbType === null) {
									continue;
								}

								const isOverride = comp.properties.some(
									(p) => p.name === "RECURRENCE-ID",
								);
								if (isOverride) {
									continue;
								}

								const hasRrule = comp.properties.some(
									(p) => p.name === "RRULE",
								);

								if (hasRrule) {
									const masterStart = getDtstartInstant(comp);
									if (!masterStart) {
										continue;
									}
									const duration =
										effectiveDtend(comp, masterStart).epochMilliseconds -
										masterStart.epochMilliseconds;
									const starts = getOccurrenceInstantsInRange(
										root,
										comp,
										queryStart,
										queryEnd,
									);
									for (const start of starts) {
										const end = Temporal.Instant.fromEpochMilliseconds(
											start.epochMilliseconds + duration,
										);
										const ps =
											start.epochMilliseconds < queryStart.epochMilliseconds
												? queryStart
												: start;
										const pe =
											end.epochMilliseconds > queryEnd.epochMilliseconds
												? queryEnd
												: end;
										periods.push({ start: ps, end: pe, fbType });
									}
								} else {
									const dtstart = getDtstartInstant(comp);
									if (!dtstart) {
										continue;
									}
									const dtend = effectiveDtend(comp, dtstart);
									if (
										dtstart.epochMilliseconds >= queryEnd.epochMilliseconds ||
										dtend.epochMilliseconds <= queryStart.epochMilliseconds
									) {
										continue;
									}
									const ps =
										dtstart.epochMilliseconds < queryStart.epochMilliseconds
											? queryStart
											: dtstart;
									const pe =
										dtend.epochMilliseconds > queryEnd.epochMilliseconds
											? queryEnd
											: dtend;
									periods.push({ start: ps, end: pe, fbType });
								}
							}
						}
					}
				}

				return buildVfreebusyText(
					queryStart,
					queryEnd,
					coalescePeriods(periods),
				);
			},
		);

		return SchedulingService.of({
			processAfterPut: (opts) => processAfterPut(opts),
			validateSchedulingChange: (opts) => validateSchedulingChange(opts),
			processAfterDelete: (opts) => processAfterDelete(opts),
			processOutboxPost: (opts) => processOutboxPost(opts),
		});
	}),
);
