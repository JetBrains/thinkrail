import type { GitDiffScope, Workspace } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { type GitResult, git, gitAsync } from "./gitExec";

export function diffBaseRef(ws: Pick<Workspace, "baseBranch" | "diffBase">): string {
	return ws.diffBase ?? ws.baseBranch;
}

export interface DiffRange {
	listPrefix: string[];
	listRevs: string[];
	untracked: boolean;
	originalRef: string | null;
	modifiedRef: string | null;
	resolvedOriginalOid: string | null;
}

const OID = /^[0-9a-f]{4,64}$/;

function throwExecutionFailure(result: GitResult): void {
	if (result.failure)
		throw new Error(`Could not resolve the diff range: ${result.err || "git failed"}`);
}

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

const EMPTY_TREE: Record<string, string> = {
	sha1: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
	sha256: "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321",
};

async function unbornRange(worktreePath: string): Promise<DiffRange | null> {
	if (resolveCommitOid(worktreePath, "HEAD")) return null;
	const format = await gitAsync(worktreePath, ["rev-parse", "--show-object-format"]);
	throwExecutionFailure(format);
	const emptyTree = EMPTY_TREE[format.out];
	if (!format.ok || !emptyTree) return null;
	return {
		listPrefix: ["diff"],
		listRevs: [emptyTree],
		untracked: true,
		originalRef: null,
		modifiedRef: null,
		resolvedOriginalOid: null,
	};
}

export async function resolveDiffRange(
	ws: Pick<Workspace, "baseBranch" | "diffBase" | "worktreePath">,
	scope: GitDiffScope = { kind: "branch" },
): Promise<DiffRange> {
	if (scope.kind === "uncommitted") {
		const unborn = await unbornRange(ws.worktreePath);
		if (unborn) return unborn;
		return {
			listPrefix: ["diff"],
			listRevs: ["HEAD"],
			untracked: true,
			originalRef: "HEAD",
			modifiedRef: null,
			resolvedOriginalOid: resolveCommitOid(ws.worktreePath, "HEAD"),
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
		throwExecutionFailure(resolved);
		if (!resolved.ok || !resolved.out)
			throw new CodedError("UNKNOWN_COMMIT", `Unknown commit: ${scope.baseRef}`);
		return {
			listPrefix: ["diff"],
			listRevs: [resolved.out],
			untracked: true,
			originalRef: resolved.out,
			modifiedRef: null,
			resolvedOriginalOid: resolved.out,
		};
	}
	if (scope.kind === "turn") {
		if (!OID.test(scope.baseTree) || !OID.test(scope.headTree))
			throw new Error(`Not a tree id: ${scope.baseTree}..${scope.headTree}`);
		for (const tree of [scope.baseTree, scope.headTree]) {
			const resolved = await gitAsync(ws.worktreePath, [
				"rev-parse",
				"--verify",
				"--quiet",
				`${tree}^{tree}`,
			]);
			throwExecutionFailure(resolved);
			if (!resolved.ok || !resolved.out)
				throw new CodedError(
					"UNKNOWN_COMMIT",
					"That turn's snapshot is no longer in this repository",
				);
		}
		return {
			listPrefix: ["diff"],
			listRevs: [scope.baseTree, scope.headTree],
			untracked: false,
			originalRef: scope.baseTree,
			modifiedRef: scope.headTree,
			resolvedOriginalOid: scope.baseTree,
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
		throwExecutionFailure(resolved);
		if (!resolved.ok || !resolved.out)
			throw new CodedError("UNKNOWN_COMMIT", `Unknown commit: ${scope.sha}`);
		const sha = resolved.out;
		const parent = await gitAsync(ws.worktreePath, [
			"rev-parse",
			"--verify",
			"--quiet",
			`${sha}^^{commit}`,
		]);
		throwExecutionFailure(parent);
		if (!parent.ok || !parent.out) {
			return {
				listPrefix: ["show", "--format="],
				listRevs: [sha],
				untracked: false,
				originalRef: null,
				modifiedRef: sha,
				resolvedOriginalOid: null,
			};
		}
		return {
			listPrefix: ["diff"],
			listRevs: [parent.out, sha],
			untracked: false,
			originalRef: parent.out,
			modifiedRef: sha,
			resolvedOriginalOid: parent.out,
		};
	}
	const base = diffBaseRef(ws);
	const mergeBase = await gitAsync(ws.worktreePath, [
		"merge-base",
		"--end-of-options",
		base,
		"HEAD",
	]);
	throwExecutionFailure(mergeBase);
	const resolvedForkPoint = mergeBase.ok && mergeBase.out ? mergeBase.out : null;
	if (!resolvedForkPoint && !resolveCommitOid(ws.worktreePath, base)) {
		const unborn = await unbornRange(ws.worktreePath);
		if (unborn) return unborn;
	}
	const forkPoint = resolvedForkPoint ?? base;
	return {
		listPrefix: ["diff"],
		listRevs: [forkPoint],
		untracked: true,
		originalRef: forkPoint,
		modifiedRef: null,
		resolvedOriginalOid: resolvedForkPoint ?? resolveCommitOid(ws.worktreePath, base),
	};
}

export function changedFileArgs(
	range: DiffRange,
	mode: "--name-status" | "--numstat" | "--shortstat",
	nul = false,
): string[] {
	return [
		...range.listPrefix,
		mode,
		...(nul ? ["-z"] : []),
		"--end-of-options",
		...range.listRevs,
		"--",
	];
}
