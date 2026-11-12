import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { Project, Workspace, WorkspacePathMatch } from "@thinkrail/contracts";
import { loadWorkspaces } from "../persistence";
import { listProjects } from "../projects";
import { listWorkspaces } from "./workspaces";

interface Candidate {
	project: Project;
	workspace: Workspace | null;
	root: string;
}

async function realThroughAncestors(path: string): Promise<string | null> {
	const rest: string[] = [];
	for (let current = path; ; ) {
		try {
			return join(await realpath(current), ...rest);
		} catch {
			const parent = dirname(current);
			if (parent === current) return null;
			rest.unshift(basename(current));
			current = parent;
		}
	}
}

function swapCase(name: string): string {
	return [...name]
		.map((char) => (char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase()))
		.join("");
}

async function caseInsensitiveAt(realRoot: string): Promise<boolean> {
	for (let dir = realRoot; dirname(dir) !== dir; dir = dirname(dir)) {
		const swapped = swapCase(basename(dir));
		if (swapped === basename(dir)) continue;
		const [own, twin] = await Promise.all([
			stat(dir).catch(() => null),
			stat(join(dirname(dir), swapped)).catch(() => null),
		]);
		return own !== null && twin !== null && own.dev === twin.dev && own.ino === twin.ino;
	}
	return false;
}

function remainder(realRoot: string, target: string, foldCase: boolean): string | null {
	const head = target.slice(0, realRoot.length);
	const same = foldCase ? head.toLowerCase() === realRoot.toLowerCase() : head === realRoot;
	if (!same) return null;
	if (realRoot.endsWith(sep)) return target.slice(realRoot.length);
	if (target.length === realRoot.length) return "";
	return target[realRoot.length] === sep ? target.slice(realRoot.length + 1) : null;
}

async function within(realRoot: string, target: string): Promise<string | null> {
	const exact = remainder(realRoot, target, false);
	if (exact !== null) return exact;
	const folded = remainder(realRoot, target, true);
	return folded !== null && (await caseInsensitiveAt(realRoot)) ? folded : null;
}

function candidates(): Candidate[] {
	const records = loadWorkspaces();
	return listProjects().flatMap((project) => {
		const own = records.filter(
			(workspace) => workspace.projectId === project.id && workspace.deletionPending !== true,
		);
		const unensured =
			project.kind !== "chats" && !own.some((workspace) => workspace.kind === "default");
		return [
			...own.map((workspace) => ({ project, workspace, root: workspace.worktreePath })),
			...(unensured ? [{ project, workspace: null, root: project.path }] : []),
		];
	});
}

async function ensuredDefault(project: Project): Promise<Workspace | null> {
	const rows = await listWorkspaces(project.id, { includeDiffStats: false });
	return rows.find((workspace) => workspace.kind === "default") ?? null;
}

export async function resolveWorkspacePath(path: string): Promise<WorkspacePathMatch | null> {
	if (!isAbsolute(path) || path.split(/[\\/]/).includes("..")) return null;
	const target = await realThroughAncestors(resolve(path));
	if (target === null) return null;
	const listed = candidates();
	const realRoots = new Map<string, Promise<string | null>>();
	for (const { root } of listed) {
		if (!realRoots.has(root))
			realRoots.set(
				root,
				realpath(root).catch(() => null),
			);
	}
	const matches = await Promise.all(
		listed.map(async (candidate) => {
			const real = (await realRoots.get(candidate.root)) ?? null;
			const rest = real === null ? null : await within(real, target);
			return real === null || rest === null ? null : { ...candidate, real, rest };
		}),
	);
	let best: (typeof matches)[number] = null;
	for (const match of matches) {
		if (match && (!best || match.real.length > best.real.length)) best = match;
	}
	if (!best || best.rest === "") return null;
	const segments = best.rest.split(sep);
	if (segments.some((segment) => segment.toLowerCase() === ".git")) return null;
	const workspace = best.workspace ?? (await ensuredDefault(best.project));
	if (!workspace) return null;
	return {
		workspaceId: workspace.id,
		projectId: best.project.id,
		relativePath: segments.join("/"),
	};
}
