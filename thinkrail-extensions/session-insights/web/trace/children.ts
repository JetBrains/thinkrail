import type { ChildEventPrefix, TraceEvent } from "@thinkrail/pi-session-insights/core";

export const CHILD_PREFIX: ChildEventPrefix = "child:";

/** A subagent transcript's event id once nested under its subagent row in the parent's trace. */
export function childEventId(childId: string, eventId: string): string {
	return `${CHILD_PREFIX}${childId}/${eventId}`;
}

/** Which transcript an event id belongs to, and its own id there. */
export function eventRef(id: string): { eventId: string; childId?: string } {
	if (!id.startsWith(CHILD_PREFIX)) return { eventId: id };
	const rest = id.slice(CHILD_PREFIX.length);
	const slash = rest.indexOf("/");
	if (slash <= 0) return { eventId: id };
	return { childId: rest.slice(0, slash), eventId: rest.slice(slash + 1) };
}

/**
 * The parent's pre-order events with each loaded subagent transcript nested right after its subagent row
 * (a leaf in the parent), ids prefixed and depths shifted, so the tree stays one pre-order list.
 */
export function nestChildren(
	events: readonly TraceEvent[],
	children: ReadonlyMap<string, readonly TraceEvent[]>,
): readonly TraceEvent[] {
	if (children.size === 0) return events;
	const out: TraceEvent[] = [];
	for (const event of events) {
		out.push(event);
		if (event.kind !== "subagent") continue;
		const nested = children.get(event.childId);
		if (!nested) continue;
		for (const child of nested)
			out.push({
				...child,
				id: childEventId(event.childId, child.id),
				parent: child.parent === null ? event.id : childEventId(event.childId, child.parent),
				depth: child.depth + event.depth + 1,
			});
	}
	return out;
}
