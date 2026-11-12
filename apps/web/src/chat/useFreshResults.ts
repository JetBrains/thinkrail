import type { BackgroundCommandSummary, SubagentResourceSummary } from "@thinkrail/contracts";
import { useCallback, useEffect, useState } from "react";
import { STORAGE_PREFIX } from "@/constants/branding";
import { getTransport } from "@/transport";
import type { ResultTarget } from "./ChatActions";

export interface FinishedResources {
	finishedCommands: readonly BackgroundCommandSummary[];
	finishedSubagents: readonly SubagentResourceSummary[];
}

export function resultTargetKey(target: ResultTarget): string {
	return target.kind === "command" ? `command:${target.id}` : `subagent:${target.childSessionId}`;
}

function finishedKeys(finished: FinishedResources): string[] {
	return [
		...finished.finishedCommands.map((command) =>
			resultTargetKey({ kind: "command", id: command.id }),
		),
		...finished.finishedSubagents.map((child) =>
			resultTargetKey({ kind: "subagent", childSessionId: child.childSessionId }),
		),
	];
}

export function freshOf(finished: FinishedResources, seen: ReadonlySet<string> | null) {
	if (seen === null) return { commands: [], subagents: [] };
	return {
		commands: finished.finishedCommands.filter(
			(command) => !seen.has(resultTargetKey({ kind: "command", id: command.id })),
		),
		subagents: finished.finishedSubagents.filter(
			(child) =>
				child.detached === true &&
				!seen.has(resultTargetKey({ kind: "subagent", childSessionId: child.childSessionId })),
		),
	};
}

export function inspectedResult(
	finished: FinishedResources,
	commandId: string | null,
	childSessionId: string | null,
): ResultTarget | null {
	if (commandId && finished.finishedCommands.some((command) => command.id === commandId))
		return { kind: "command", id: commandId };
	if (
		childSessionId &&
		finished.finishedSubagents.some((child) => child.childSessionId === childSessionId)
	)
		return { kind: "subagent", childSessionId };
	return null;
}

export function rememberSeen(
	seen: ReadonlySet<string> | null,
	keys: readonly string[],
	replace: boolean,
): ReadonlySet<string> | null {
	if (replace) return new Set(keys);
	if (seen === null) return null;
	return new Set([...seen, ...keys]);
}

function storageKey(workspaceId: string, sessionId: string): string {
	return `${STORAGE_PREFIX}seen-results:${getTransport().httpBase()}:${workspaceId}:${sessionId}`;
}

function readSeen(key: string): ReadonlySet<string> | null {
	try {
		const raw = localStorage.getItem(key);
		const parsed: unknown = raw === null ? null : JSON.parse(raw);
		return Array.isArray(parsed)
			? new Set(parsed.filter((value): value is string => typeof value === "string"))
			: null;
	} catch {
		return null;
	}
}

function writeSeen(key: string, seen: ReadonlySet<string>): void {
	try {
		localStorage.setItem(key, JSON.stringify([...seen]));
	} catch {}
}

export function useFreshResults(
	workspaceId: string,
	sessionId: string,
	finished: FinishedResources,
	authoritative: boolean,
) {
	const key = storageKey(workspaceId, sessionId);
	const [stored, setStored] = useState(() => ({ key, seen: readSeen(key) }));
	const seen = stored.key === key ? stored.seen : readSeen(key);
	const remember = useCallback(
		(keys: readonly string[], replace: boolean) =>
			setStored((previous) => {
				const next = rememberSeen(
					previous.key === key ? previous.seen : readSeen(key),
					keys,
					replace,
				);
				if (next) writeSeen(key, next);
				return { key, seen: next };
			}),
		[key],
	);
	useEffect(() => {
		if (stored.key !== key) setStored({ key, seen: readSeen(key) });
		else if (authoritative && seen === null) remember(finishedKeys(finished), true);
	}, [stored.key, key, authoritative, seen, finished, remember]);
	const fresh = freshOf(finished, seen);
	return {
		commands: fresh.commands,
		subagents: fresh.subagents,
		count: fresh.commands.length + fresh.subagents.length,
		markSeen: useCallback(
			(target: ResultTarget) => remember([resultTargetKey(target)], false),
			[remember],
		),
		markAllSeen: useCallback(
			() => remember(finishedKeys(finished), authoritative),
			[remember, finished, authoritative],
		),
	};
}
