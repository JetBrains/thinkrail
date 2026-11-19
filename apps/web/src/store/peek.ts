import type { SessionState } from "@thinkrail/contracts";
import { layoutResourceIdentity, tupleKey } from "../lib";

interface PeekOpener {
	sessionId?: string;
}

export type PeekEntry =
	| ({ kind: "file"; path: string; line?: number } & PeekOpener)
	| ({ kind: "compare"; before: string; after: string } & PeekOpener)
	| ({
			kind: "extension";
			extension: string;
			panel: string;
			params: Readonly<Record<string, string>>;
			titleKey: string;
	  } & PeekOpener)
	| ({ kind: "container"; containerId: string } & PeekOpener);

export interface PeekState {
	stack: readonly PeekEntry[];
	index: number;
	pinned: boolean;
	open: boolean;
}

export const PEEK_STACK_LIMIT = 20;

export function peekEntryIdentity(entry: PeekEntry): string {
	switch (entry.kind) {
		case "file":
			return layoutResourceIdentity({ kind: "file", path: entry.path });
		case "compare":
			return layoutResourceIdentity({ kind: "diff", path: entry.after, before: entry.before });
		case "extension":
			return layoutResourceIdentity(entry);
		case "container":
			return tupleKey("peek-resource", "container", entry.containerId);
	}
}

function samePeekEntry(a: PeekEntry, b: PeekEntry): boolean {
	if (peekEntryIdentity(a) !== peekEntryIdentity(b) || a.sessionId !== b.sessionId) return false;
	if (a.kind === "file" && b.kind === "file") return a.line === b.line;
	if (a.kind === "extension" && b.kind === "extension") return a.titleKey === b.titleKey;
	return true;
}

export function pushPeekEntry(current: PeekState | undefined, entry: PeekEntry): PeekState {
	const stack = current?.stack ?? [];
	const pinned = current?.pinned ?? false;
	const identity = peekEntryIdentity(entry);
	const existing = stack.findIndex((candidate) => peekEntryIdentity(candidate) === identity);
	if (existing < 0) {
		const grown = [...stack, entry].slice(-PEEK_STACK_LIMIT);
		return { stack: grown, index: grown.length - 1, pinned, open: true };
	}
	const held = stack[existing];
	if (current?.open && current.index === existing && held && samePeekEntry(held, entry)) {
		return current;
	}
	const refreshed = held && samePeekEntry(held, entry) ? stack : stack.with(existing, entry);
	return { stack: refreshed, index: existing, pinned, open: true };
}

export function followPeekEntry(
	current: PeekState | undefined,
	from: PeekEntry,
	entry: PeekEntry,
): PeekState | undefined {
	const shown = current?.open ? current.stack[current.index] : undefined;
	if (!current || !shown || peekEntryIdentity(shown) !== peekEntryIdentity(from)) return current;
	const identity = peekEntryIdentity(entry);
	const existing = current.stack.findIndex(
		(candidate) => peekEntryIdentity(candidate) === identity,
	);
	if (existing < 0) return { ...current, stack: current.stack.with(current.index, entry) };
	if (existing === current.index) return pushPeekEntry(current, entry);
	return pushPeekEntry(removePeekEntry(current, current.index), entry);
}

export function showPeekIndex(
	current: PeekState | undefined,
	index: number,
): PeekState | undefined {
	if (!current || index < 0 || index >= current.stack.length || index === current.index) {
		return current;
	}
	return { ...current, index };
}

export function removePeekEntry(
	current: PeekState | undefined,
	index: number,
): PeekState | undefined {
	if (!current || index < 0 || index >= current.stack.length) return current;
	const stack = current.stack.filter((_, position) => position !== index);
	if (stack.length === 0) return undefined;
	const shifted =
		current.index > index || (current.index === index && current.index > 0)
			? current.index - 1
			: current.index;
	return { ...current, stack, index: Math.min(shifted, stack.length - 1) };
}

export function hidePeek(current: PeekState | undefined): PeekState | undefined {
	if (!current || (!current.open && !current.pinned)) return current;
	return { ...current, open: false, pinned: false };
}

/** Opens the shown container overview on `to`, pinned if either Peek was, so a member switch keeps it showing. */
export function carryPeekEntry(
	from: PeekState | undefined,
	to: PeekState | undefined,
): PeekState | undefined {
	const entry = from?.open ? from.stack[from.index] : undefined;
	if (!from || entry?.kind !== "container") return to;
	const pushed = pushPeekEntry(to, entry);
	return from.pinned && !pushed.pinned ? { ...pushed, pinned: true } : pushed;
}

export function startsNewTurn(
	previous: SessionState | undefined,
	next: SessionState | undefined,
): boolean {
	if (!previous || !next) return false;
	return (
		(next.runId !== null && next.runId !== previous.runId) ||
		(previous.needsInput !== null && next.needsInput === null)
	);
}

type SessionStateLookup = (workspaceId: string, sessionId: string) => SessionState | undefined;

export function peeksAfterTurns(
	peeks: Record<string, PeekState>,
	previous: SessionStateLookup,
	next: SessionStateLookup,
): Record<string, PeekState> {
	let result = peeks;
	for (const [workspaceId, peek] of Object.entries(peeks)) {
		if (!peek.open || peek.pinned) continue;
		const sessionId = peek.stack[peek.index]?.sessionId;
		if (!sessionId) continue;
		if (!startsNewTurn(previous(workspaceId, sessionId), next(workspaceId, sessionId))) continue;
		if (result === peeks) result = { ...peeks };
		result[workspaceId] = { ...peek, open: false };
	}
	return result;
}

export function peeksWithoutContainers(
	peeks: Record<string, PeekState>,
	gone: (containerId: string) => boolean,
): Record<string, PeekState> {
	return peeksWithout(peeks, (entry) => entry.kind === "container" && gone(entry.containerId));
}

export function peeksWithoutExtensions(
	peeks: Record<string, PeekState>,
	disabled: readonly string[],
): Record<string, PeekState> {
	if (disabled.length === 0) return peeks;
	const off = new Set(disabled);
	return peeksWithout(peeks, (entry) => entry.kind === "extension" && off.has(entry.extension));
}

function peeksWithout(
	peeks: Record<string, PeekState>,
	gone: (entry: PeekEntry) => boolean,
): Record<string, PeekState> {
	let result = peeks;
	for (const [workspaceId, peek] of Object.entries(peeks)) {
		if (!peek.stack.some(gone)) continue;
		if (result === peeks) result = { ...peeks };
		let next: PeekState | undefined = peek;
		for (let index = peek.stack.length - 1; index >= 0; index -= 1) {
			const entry = peek.stack[index];
			if (entry && gone(entry)) next = removePeekEntry(next, index);
		}
		if (next) result[workspaceId] = next;
		else delete result[workspaceId];
	}
	return result;
}
