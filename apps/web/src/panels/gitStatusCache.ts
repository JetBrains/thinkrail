import type { GitDiffScope, GitStatus } from "@thinkrail/contracts";
import { scopeKey } from "./changesModel";

const lastStatus = new Map<string, GitStatus>();

const cacheKey = (workspaceId: string, scope: GitDiffScope, targetRef: string) =>
	`${workspaceId}\u0000${scopeKey(scope)}\u0000${targetRef}`;

export function peekGitStatus(
	workspaceId: string,
	scope: GitDiffScope,
	targetRef: string,
): GitStatus | null {
	return lastStatus.get(cacheKey(workspaceId, scope, targetRef)) ?? null;
}

export function rememberGitStatus(
	workspaceId: string,
	scope: GitDiffScope,
	targetRef: string,
	status: GitStatus,
): void {
	lastStatus.set(cacheKey(workspaceId, scope, targetRef), status);
}

export function forgetGitStatus(workspaceId: string, scope: GitDiffScope, targetRef: string): void {
	lastStatus.delete(cacheKey(workspaceId, scope, targetRef));
}
