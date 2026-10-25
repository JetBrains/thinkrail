import type { GitDiffScope, GitStatus } from "@thinkrail/contracts";
import { useAppStore } from "../store";
import { getTransport, wsErrorCode } from "../transport";
import { scopeKey } from "./changesModel";

export const GIT_STATUS_CACHE_SIZE = 32;

interface Entry {
	workspaceId: string;
	status: GitStatus;
	requested: number;
}

const entries = new Map<string, Entry>();
let requests = 0;
let watchingRemovals = false;

const cacheKey = (workspaceId: string, scope: GitDiffScope, targetRef: string) =>
	`${workspaceId}\u0000${scopeKey(scope)}\u0000${targetRef}`;

function forgetRemovedWorkspaces(removed: Record<string, true>): void {
	for (const [key, entry] of entries) if (removed[entry.workspaceId]) entries.delete(key);
}

function watchRemovals(): void {
	if (watchingRemovals) return;
	watchingRemovals = true;
	useAppStore.subscribe((state, previous) => {
		if (state.removedWorkspaceIds !== previous.removedWorkspaceIds) {
			forgetRemovedWorkspaces(state.removedWorkspaceIds);
		}
	});
}

function remember(key: string, entry: Entry): void {
	const current = entries.get(key);
	if (current && current.requested > entry.requested) return;
	if (useAppStore.getState().removedWorkspaceIds[entry.workspaceId]) return;
	watchRemovals();
	entries.delete(key);
	entries.set(key, entry);
	for (const oldest of entries.keys()) {
		if (entries.size <= GIT_STATUS_CACHE_SIZE) break;
		entries.delete(oldest);
	}
}

export function peekGitStatus(
	workspaceId: string,
	scope: GitDiffScope,
	targetRef: string,
): GitStatus | null {
	const key = cacheKey(workspaceId, scope, targetRef);
	const entry = entries.get(key);
	if (!entry) return null;
	entries.delete(key);
	entries.set(key, entry);
	return entry.status;
}

export async function readGitStatus(
	workspaceId: string,
	scope: GitDiffScope,
	targetRef: string,
): Promise<GitStatus> {
	const key = cacheKey(workspaceId, scope, targetRef);
	const requested = ++requests;
	try {
		const status = await getTransport().request("git.status", { workspaceId, scope });
		remember(key, { workspaceId, status, requested });
		return status;
	} catch (error) {
		if (wsErrorCode(error) === "UNKNOWN_COMMIT") entries.delete(key);
		throw error;
	}
}
