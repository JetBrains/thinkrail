import type {
	BackgroundCommandOutputResult,
	SessionResources,
	SubagentResourceSummary,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import type { ChildHandle } from "pi-delegation";
import { withSessionResources } from "./agentSessionManager";
import { delegationServiceFor } from "./delegation";

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

function subagents(workspaceId: string, parentSessionId: string): SubagentResourceSummary[] {
	const active: ChildHandle[] = [];
	const terminal: ChildHandle[] = [];
	for (const child of delegationServiceFor(workspaceId).childrenOf(parentSessionId)) {
		const { record, snapshot } = child;
		if (!snapshot || record.scope !== workspaceId || record.parentSessionId !== parentSessionId)
			continue;
		(snapshot.status === "running" || snapshot.status === "queued" ? active : terminal).push(child);
	}
	return [...active, ...terminal.slice(-20)].flatMap(({ record, snapshot }) => {
		if (!snapshot) return [];
		const summary: SubagentResourceSummary = {
			childSessionId: record.sessionId,
			parentSessionId,
			...(record.info.roleName !== undefined
				? { roleName: record.info.roleName.slice(0, 200) }
				: {}),
			task: snapshot.task.slice(0, 2000),
			status: snapshot.status,
			createdAt: record.createdAt,
			...(snapshot.details.abortReason !== undefined
				? { abortReason: snapshot.details.abortReason }
				: {}),
		};
		return [summary];
	});
}

export function getSessionResources(
	workspaceId: string,
	sessionId: string,
	cwd: string,
): Promise<SessionResources> {
	return withSessionResources(workspaceId, sessionId, cwd, (commands) => ({
		workspaceId,
		sessionId,
		commands: commands.list(),
		subagents: subagents(workspaceId, sessionId),
	}));
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
		if (!handle || !output) return { available: false };
		return { available: true, command: handle.snapshot, output };
	});
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
	return withSessionResources(workspaceId, parentSessionId, cwd, () =>
		childFor(workspaceId, parentSessionId, childSessionId).abort("user"),
	);
}

export function stopAllSubagents(
	workspaceId: string,
	parentSessionId: string,
	cwd: string,
): Promise<number> {
	return withSessionResources(workspaceId, parentSessionId, cwd, async () => {
		const children = delegationServiceFor(workspaceId)
			.childrenOf(parentSessionId)
			.filter(
				(child) =>
					child.record.scope === workspaceId &&
					child.record.parentSessionId === parentSessionId &&
					(child.snapshot?.status === "queued" || child.snapshot?.status === "running"),
			);
		const settling = children.map((child) => child.abort("user"));
		await Promise.all(settling);
		return children.length;
	});
}
