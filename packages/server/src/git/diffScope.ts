import type { GitDiffScope, Workspace } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { git, gitAsync } from "./gitExec";

export function diffBaseRef(ws: Pick<Workspace, "baseBranch" | "diffBase">): string {
	return ws.diffBase ?? ws.baseBranch;
}

export interface DiffRange {
	listPrefix: string[];
	listRevs: string[];
	untracked: boolean;
	originalRef: string | null;
	modifiedRef: string | null;
}

const OID = /^[0-9a-f]{4,64}$/;

export function resolveCommitOid(worktreePath: string, ref: string): string | null {
	const out = git(worktreePath, [
		"rev-parse",
		"--verify",
		"--quiet",
		"--end-of-options",
		`${ref}^{commit}`,
	]);
	return out.ok && out.out ? out.out : null;
}

export async function resolveDiffRange(
	ws: Pick<Workspace, "baseBranch" | "diffBase" | "worktreePath">,
	scope: GitDiffScope = { kind: "branch" },
): Promise<DiffRange> {
	if (scope.kind === "uncommitted") {
		return {
			listPrefix: ["diff"],
			listRevs: ["HEAD"],
			untracked: true,
			originalRef: "HEAD",
			modifiedRef: null,
		};
	}
	if (scope.kind === "pinned") {
		if (!OID.test(scope.baseRef)) throw new Error(`Not a commit id: ${scope.baseRef}`);
		const resolved = await gitAsync(ws.worktreePath, [
			"rev-parse",
			"--verify",
			"--quiet",
			`${scope.baseRef}^{commit}`,
		]);
		if (!resolved.ok || !resolved.out)
			throw new CodedError("UNKNOWN_COMMIT", `Unknown commit: ${scope.baseRef}`);
		return {
			listPrefix: ["diff"],
			listRevs: [resolved.out],
			untracked: true,
			originalRef: resolved.out,
			modifiedRef: null,
		};
	}
	if (scope.kind === "commit") {
		if (!OID.test(scope.sha)) throw new Error(`Not a commit id: ${scope.sha}`);
		const resolved = await gitAsync(ws.worktreePath, [
			"rev-parse",
			"--verify",
			"--quiet",
			`${scope.sha}^{commit}`,
		]);
		if (!resolved.ok || !resolved.out)
			throw new CodedError("UNKNOWN_COMMIT", `Unknown commit: ${scope.sha}`);
		const sha = resolved.out;
		const parent = await gitAsync(ws.worktreePath, [
			"rev-parse",
			"--verify",
			"--quiet",
			`${sha}^^{commit}`,
		]);
		if (!parent.ok || !parent.out) {
			return {
				listPrefix: ["show", "--format="],
				listRevs: [sha],
				untracked: false,
				originalRef: null,
				modifiedRef: sha,
			};
		}
		return {
			listPrefix: ["diff"],
			listRevs: [parent.out, sha],
			untracked: false,
			originalRef: parent.out,
			modifiedRef: sha,
		};
	}
	const base = diffBaseRef(ws);
	const mergeBase = await gitAsync(ws.worktreePath, [
		"merge-base",
		"--end-of-options",
		base,
		"HEAD",
	]);
	const forkPoint = mergeBase.ok && mergeBase.out ? mergeBase.out : base;
	return {
		listPrefix: ["diff"],
		listRevs: [forkPoint],
		untracked: true,
		originalRef: forkPoint,
		modifiedRef: null,
	};
}

export function changedFileArgs(
	range: DiffRange,
	mode: "--name-status" | "--numstat" | "--shortstat",
): string[] {
	return [...range.listPrefix, mode, "--end-of-options", ...range.listRevs, "--"];
}
