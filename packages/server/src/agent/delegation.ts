import { rmSync } from "node:fs";
import { join } from "node:path";
import { buildSessionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import {
	type DelegationRunStatus,
	isTranscriptMessageRole,
	type TranscriptMessage,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	createDelegationService,
	type DelegationService,
	deriveChildSessionFile,
} from "pi-delegation";
import { createSubagentsExtension } from "pi-subagents";
import { dataDir } from "../persistence";
import { liveParentContext } from "./agentSessionManager";
import { type BundledExtensionFactory, childExtensionFactories } from "./extensions";
import { getPiRuntime } from "./piRuntime";

export function delegationRootDir(): string {
	return join(dataDir(), "delegation");
}

const services = new Map<string, DelegationService>();

export function delegationServiceFor(workspaceId: string): DelegationService {
	let service = services.get(workspaceId);
	if (!service) {
		service = createDelegationService({
			resolveParent: liveParentContext,
			delegationRoot: delegationRootDir(),
			scope: workspaceId,
			modelRuntime: getPiRuntime,
			childExtensionFactories: childExtensionFactories(),
		});
		services.set(workspaceId, service);
	}
	return service;
}

export function subagentsExtensionFor(workspaceId: string): BundledExtensionFactory {
	return createSubagentsExtension({
		service: delegationServiceFor(workspaceId),
		delegationRoot: delegationRootDir(),
		scope: workspaceId,
	});
}

export async function disposeSessionChildren(
	workspaceId: string,
	parentSessionId: string,
): Promise<void> {
	await services.get(workspaceId)?.disposeChildrenOf(parentSessionId);
}

export function removeWorkspaceDelegation(workspaceId: string): void {
	services.delete(workspaceId);
	rmSync(join(delegationRootDir(), workspaceId), { recursive: true, force: true });
}

function assertPathSegment(value: string, label: string): void {
	if (value.length === 0 || value.includes("/") || value.includes("\\") || value.includes("..")) {
		throw new Error(`Invalid ${label}: not a plain id`);
	}
}

export function readChildTranscript(
	workspaceId: string,
	parentSessionId: string,
	childSessionId: string,
): { messages: TranscriptMessage[]; status?: DelegationRunStatus } {
	assertPathSegment(workspaceId, "workspaceId");
	assertPathSegment(parentSessionId, "parentSessionId");
	assertPathSegment(childSessionId, "childSessionId");
	const path = deriveChildSessionFile(
		delegationRootDir(),
		workspaceId,
		parentSessionId,
		childSessionId,
	);
	if (!path) {
		throw new CodedError(
			"SUBAGENT_TRANSCRIPT_NOT_FOUND",
			`No transcript found for subagent session ${childSessionId}`,
		);
	}
	const sessionManager = SessionManager.open(path);
	const messages = buildSessionContext(sessionManager.getEntries()).messages.filter((message) =>
		isTranscriptMessageRole(message.role),
	) as TranscriptMessage[];
	const status = services.get(workspaceId)?.findChild(childSessionId)?.snapshot?.status;
	return { messages, ...(status !== undefined ? { status } : {}) };
}
