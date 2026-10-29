import {
	type BackgroundCommandOutputResult,
	type BackgroundCommandStatus,
	type BackgroundCommandSummary,
	compareResourceHistory,
	isLiveResource,
	RESOURCE_HISTORY_MAX_PAGE_LIMIT,
	RESOURCE_HISTORY_PAGE_LIMIT,
	type ResourceHistoryCursor,
	type ResourceHistoryPage,
	type ResourceKind,
	type ResourceRecord,
	resourceHistoryCursor,
	resourceRecordId,
	type SessionResources,
	type SubagentResourceSummary,
	tallyResources,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import type { BackgroundCommands } from "pi-background-commands";
import type { ChildHandle, DelegationService, LifecycleEvent } from "pi-delegation";
import {
	archivedCommandOutput,
	finishedResources,
	pageResources,
	recordResource,
} from "../resourceHistory";
import { canUseSessionResources, withSessionResources } from "./agentSessionManager";
import { delegationServiceFor, stopSessionChildren } from "./delegation";
import { mcpResourceSummaries } from "./mcpSessions";

let publish: (payload: { workspaceId: string; sessionId: string }) => void = () => {};
export function setSessionResourcesPublisher(fn: typeof publish): void {
	publish = fn;
}
export function publishSessionResourcesChanged(workspaceId: string, sessionId: string): void {
	publish({ workspaceId, sessionId });
}

function unavailable(): CodedError {
	return new CodedError("RESOURCE_UNAVAILABLE", "Resource unavailable");
}

function childFor(
	workspaceId: string,
	parentSessionId: string,
	childSessionId: string,
): ChildHandle {
	const child = delegationServiceFor(workspaceId).findChild(childSessionId);
	if (
		!child ||
		child.record.scope !== workspaceId ||
		child.record.parentSessionId !== parentSessionId
	)
		throw unavailable();
	return child;
}

function subagentSummary(
	{ record, snapshot }: ChildHandle,
	parentSessionId: string,
): SubagentResourceSummary | undefined {
	if (!snapshot) return undefined;
	const live = snapshot.status === "running" || snapshot.status === "queued";
	return {
		childSessionId: record.sessionId,
		parentSessionId,
		...(record.info.roleName !== undefined ? { roleName: record.info.roleName.slice(0, 200) } : {}),
		task: snapshot.task.slice(0, 2000),
		status: snapshot.status,
		createdAt: record.createdAt,
		...(record.info.detached === true ? { detached: true } : {}),
		...(snapshot.details.model !== undefined ? { model: snapshot.details.model } : {}),
		...(snapshot.details.thinkingLevel !== undefined
			? { thinkingLevel: snapshot.details.thinkingLevel }
			: {}),
		...(snapshot.details.abortReason !== undefined
			? { abortReason: snapshot.details.abortReason }
			: {}),
		...(live ? {} : { durationMs: snapshot.details.durationMs }),
	};
}

function ownedChildren(workspaceId: string, parentSessionId: string): ResourceRecord[] {
	return delegationServiceFor(workspaceId)
		.childrenOf(parentSessionId)
		.flatMap((child): ResourceRecord[] => {
			if (child.record.scope !== workspaceId || child.record.parentSessionId !== parentSessionId)
				return [];
			const summary = subagentSummary(child, parentSessionId);
			return summary ? [{ kind: "subagent", summary }] : [];
		});
}

function commandRecords(commands: BackgroundCommands): ResourceRecord[] {
	return commands.list().map((summary): ResourceRecord => ({ kind: "command", summary }));
}

function historyOf(
	scope: { workspaceId: string; sessionId: string },
	kind: ResourceKind,
	current: readonly ResourceRecord[],
) {
	const live = current.filter(isLiveResource);
	const settled = new Map(
		current
			.filter((record) => !isLiveResource(record))
			.map((record) => [resourceRecordId(record), record]),
	);
	const finished = finishedResources(scope, kind, new Set(live.map(resourceRecordId))).map(
		(record) => (record.summary.interrupted && settled.get(resourceRecordId(record))) || record,
	);
	const archived = new Set(finished.map(resourceRecordId));
	for (const [id, record] of settled) if (!archived.has(id)) finished.push(record);
	finished.sort((a, b) =>
		compareResourceHistory(resourceHistoryCursor(a), resourceHistoryCursor(b)),
	);
	return { live, finished };
}

function commandHistory(
	workspaceId: string,
	sessionId: string,
	commands: BackgroundCommands,
): ReturnType<typeof historyOf> {
	return historyOf({ workspaceId, sessionId }, "command", commandRecords(commands));
}

function subagentHistory(workspaceId: string, sessionId: string): ReturnType<typeof historyOf> {
	return historyOf({ workspaceId, sessionId }, "subagent", ownedChildren(workspaceId, sessionId));
}

function commandSummaries(records: readonly ResourceRecord[]): BackgroundCommandSummary[] {
	return records.flatMap((record) => (record.kind === "command" ? [record.summary] : []));
}

function subagentSummaries(records: readonly ResourceRecord[]): SubagentResourceSummary[] {
	return records.flatMap((record) => (record.kind === "subagent" ? [record.summary] : []));
}

export function getSessionResources(
	workspaceId: string,
	sessionId: string,
	cwd: string,
): Promise<SessionResources> {
	return withSessionResources(workspaceId, sessionId, cwd, (commands) => {
		const command = commandHistory(workspaceId, sessionId, commands);
		const subagent = subagentHistory(workspaceId, sessionId);
		const window = (history: ReturnType<typeof historyOf>) => [
			...history.live,
			...history.finished.slice(0, RESOURCE_HISTORY_PAGE_LIMIT),
		];
		return {
			workspaceId,
			sessionId,
			commands: commandSummaries(window(command)),
			subagents: subagentSummaries(window(subagent)),
			mcpServers: mcpResourceSummaries(sessionId),
			history: {
				commands: tallyResources(command.finished),
				subagents: tallyResources(subagent.finished),
			},
		};
	});
}

export function getResourceHistoryPage(
	workspaceId: string,
	sessionId: string,
	cwd: string,
	request: { kind: ResourceKind; before?: ResourceHistoryCursor; limit?: number },
): Promise<ResourceHistoryPage> {
	const limit = Math.min(
		Math.max(Math.trunc(request.limit ?? RESOURCE_HISTORY_PAGE_LIMIT), 1),
		RESOURCE_HISTORY_MAX_PAGE_LIMIT,
	);
	return withSessionResources(workspaceId, sessionId, cwd, (commands): ResourceHistoryPage => {
		if (request.kind === "command") {
			const page = pageResources(
				commandHistory(workspaceId, sessionId, commands).finished,
				request.before,
				limit,
			);
			return { kind: "command", items: commandSummaries(page.items), hasMore: page.hasMore };
		}
		const page = pageResources(
			subagentHistory(workspaceId, sessionId).finished,
			request.before,
			limit,
		);
		return { kind: "subagent", items: subagentSummaries(page.items), hasMore: page.hasMore };
	});
}

export function readBackgroundCommandOutput(
	workspaceId: string,
	sessionId: string,
	commandId: string,
	cwd: string,
): Promise<BackgroundCommandOutputResult> {
	return withSessionResources(workspaceId, sessionId, cwd, (commands) => {
		const handle = commands.find(commandId);
		const output = handle?.output;
		if (handle && output) return { available: true, command: handle.snapshot, output };
		const archived = commandHistory(workspaceId, sessionId, commands).finished.find(
			(record) => resourceRecordId(record) === commandId,
		);
		const log = archived && archivedCommandOutput({ workspaceId, sessionId }, commandId);
		return archived?.kind === "command" && log
			? { available: true, command: archived.summary, output: log }
			: { available: false };
	});
}

export function archiveCommandHistory(
	workspaceId: string,
	sessionId: string,
	commands: BackgroundCommands,
	closing: () => boolean,
): { finish: () => void } {
	const scope = { workspaceId, sessionId };
	const recorded = new Map<string, BackgroundCommandStatus>();
	const requestedStops = new Set<string>();
	let finished = false;
	const sync = () => {
		if (finished) return;
		const listed = new Set<string>();
		for (const snapshot of commands.list()) {
			listed.add(snapshot.id);
			if (recorded.get(snapshot.id) === snapshot.status) continue;
			recorded.set(snapshot.id, snapshot.status);
			if (snapshot.status === "stopping" && !closing()) requestedStops.add(snapshot.id);
			const cutOff = snapshot.status === "stopped" && closing() && !requestedStops.has(snapshot.id);
			const record: ResourceRecord = {
				kind: "command",
				summary: cutOff ? { ...snapshot, interrupted: true } : snapshot,
			};
			recordResource(
				scope,
				record,
				isLiveResource(record) ? undefined : commands.find(snapshot.id)?.output,
			);
		}
		for (const id of recorded.keys()) {
			if (listed.has(id)) continue;
			recorded.delete(id);
			requestedStops.delete(id);
		}
	};
	const unsubscribe = commands.onChange(sync);
	sync();
	return {
		finish: () => {
			sync();
			finished = true;
			unsubscribe();
			for (const snapshot of commands.list()) {
				if (!isLiveResource({ kind: "command", summary: snapshot })) continue;
				recordResource(
					scope,
					{ kind: "command", summary: { ...snapshot, interrupted: true } },
					commands.find(snapshot.id)?.output,
				);
			}
		},
	};
}

export function archiveSubagentRun(
	workspaceId: string,
	service: DelegationService,
	event: LifecycleEvent,
): void {
	if (event.type !== "run-queued" && event.type !== "run-started" && event.type !== "run-terminal")
		return;
	const child = service.findChild(event.sessionId);
	if (!child || child.record.scope !== workspaceId) return;
	const summary = subagentSummary(child, event.parentSessionId);
	if (!summary) return;
	const terminal = event.type === "run-terminal";
	const cutOff =
		terminal &&
		summary.status === "aborted" &&
		summary.abortReason === undefined &&
		!canUseSessionResources(event.parentSessionId, workspaceId);
	recordResource(
		{ workspaceId, sessionId: event.parentSessionId },
		{
			kind: "subagent",
			summary: {
				...summary,
				...(terminal ? { finishedAt: Date.now() } : {}),
				...(cutOff ? { interrupted: true } : {}),
			},
		},
	);
}

export function stopBackgroundCommand(
	workspaceId: string,
	sessionId: string,
	commandId: string,
	cwd: string,
): Promise<void> {
	return withSessionResources(workspaceId, sessionId, cwd, (commands) => {
		const handle = commands.find(commandId);
		if (!handle) throw unavailable();
		handle.stop();
	});
}

export function stopSubagent(
	workspaceId: string,
	parentSessionId: string,
	childSessionId: string,
	cwd: string,
): Promise<void> {
	return withSessionResources(workspaceId, parentSessionId, cwd, () => {
		void childFor(workspaceId, parentSessionId, childSessionId)
			.abort("user")
			.catch(() => {});
	});
}

export function stopAllSubagents(
	workspaceId: string,
	parentSessionId: string,
	cwd: string,
): Promise<number> {
	return withSessionResources(
		workspaceId,
		parentSessionId,
		cwd,
		() => stopSessionChildren(workspaceId, parentSessionId, "user").stopped,
	);
}
