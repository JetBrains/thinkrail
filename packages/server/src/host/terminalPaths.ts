import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import {
	MAX_TERMINAL_PATH_CANDIDATES,
	MAX_TERMINAL_PATH_LENGTH,
	type TerminalPathTarget,
} from "@thinkrail/contracts";
import { worktreeEntryKind } from "../fs";
import { terminalCwds } from "../terminal";
import { getWorkspace, matchWorkspacePaths } from "../workspaces";

export interface TerminalPathScope {
	workspaceId: string;
	cwds: () => Promise<readonly string[]>;
}

const NO_TARGET: TerminalPathTarget = { kind: null, relPath: null };

function assertPathCandidates(candidates: unknown): asserts candidates is readonly string[] {
	if (
		!Array.isArray(candidates) ||
		candidates.length > MAX_TERMINAL_PATH_CANDIDATES ||
		!candidates.every(
			(candidate) =>
				typeof candidate === "string" &&
				candidate.length > 0 &&
				candidate.length <= MAX_TERMINAL_PATH_LENGTH,
		)
	) {
		throw new Error("Invalid path candidates");
	}
}

function expandHome(path: string, home: string): string {
	if (path === "~") return home;
	if (path.startsWith("~/") || (sep === "\\" && path.startsWith("~\\"))) {
		return join(home, path.slice(2));
	}
	return path;
}

export async function locateTerminalPaths(
	scope: TerminalPathScope,
	candidates: readonly string[],
	home: string = homedir(),
): Promise<TerminalPathTarget[]> {
	const root = getWorkspace(scope.workspaceId).worktreePath;
	const expanded = candidates.map((candidate) => expandHome(candidate, home));
	const cwds = expanded.every((path) => isAbsolute(path))
		? []
		: await scope.cwds().catch((): readonly string[] => []);
	const bases = [...new Set([...cwds.filter((base) => isAbsolute(base)), root])];
	const attempts = expanded.map((path) =>
		isAbsolute(path) ? [resolve(path)] : bases.map((base) => resolve(base, path)),
	);
	const tried = [...new Set(attempts.flat())];
	const owners = await matchWorkspacePaths(tried);
	const ownerOf = new Map(tried.map((path, index) => [path, owners[index] ?? null]));
	return attempts.map((paths) => {
		for (const path of paths) {
			const owner = ownerOf.get(path);
			if (!owner || owner.workspace?.id !== scope.workspaceId) continue;
			const kind = worktreeEntryKind(root, owner.relativePath);
			if (kind) return { kind, relPath: owner.relativePath };
		}
		return NO_TARGET;
	});
}

export async function resolveTerminalPaths(
	id: string,
	candidates: unknown,
): Promise<TerminalPathTarget[]> {
	assertPathCandidates(candidates);
	const scope = terminalCwds(id);
	if (!scope) throw new Error("Unknown terminal");
	return locateTerminalPaths(scope, candidates);
}
