import { join, resolve } from "node:path";
import type { Project } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	type ClonePlan,
	getSessionWorkspaceId,
	type OpenedProject,
	type OpenProjectOutcome,
	type OpenProjectParams,
	type OpenProjectPlan,
	type ProjectToolsHost,
} from "../agent";
import { gitAsync } from "../git";
import {
	cloneProject,
	inspectCloneDestination,
	inspectProjectPath,
	listProjects,
	listRecentProjects,
	openProject,
	resolveProjectPath,
	validateCloneUrl,
} from "../projects";
import { getConfig, markProjectsFolderNoticeShown } from "../settings";
import { getWorkspace, isChatsContainer } from "../workspaces";

const REMOTE_READ_TIMEOUT_MS = 10_000;
const MAX_NAME_SUFFIX = 99;
const GITHUB_SHORTHAND = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/;
const PATH_LIKE = /^(?:~(?:$|[\\/])|\.{1,2}(?:$|[\\/])|\/|[A-Za-z]:[\\/]|\\\\)/;

export interface ProjectToolsDeps {
	callerCwd: (sessionId: string) => string;
	remoteUrls: (path: string) => Promise<string[]>;
}

function callerCwd(sessionId: string): string {
	const workspaceId = getSessionWorkspaceId(sessionId);
	if (!workspaceId) throw new Error("open_project is only available in a top-level chat.");
	return getWorkspace(workspaceId).worktreePath;
}

async function remoteUrls(path: string): Promise<string[]> {
	const result = await gitAsync(path, ["config", "--get-regexp", "^remote\\..*\\.url$"], {
		timeoutMs: REMOTE_READ_TIMEOUT_MS,
	});
	if (!result.ok) return [];
	return result.out
		.split("\n")
		.map((line) => line.slice(line.indexOf(" ") + 1).trim())
		.filter(Boolean);
}

const liveDeps: ProjectToolsDeps = { callerCwd, remoteUrls };

export const projectToolsHost: ProjectToolsHost = {
	plan: (callerSessionId, params) => planOpenProject(callerSessionId, params, liveDeps),
	clone: (callerSessionId, plan, signal) =>
		cloneOpenProject(callerSessionId, plan, liveDeps, signal),
};

export function isPathLike(repository: string): boolean {
	return PATH_LIKE.test(repository);
}

export function expandRepository(repository: string): string {
	return GITHUB_SHORTHAND.test(repository) && !repository.startsWith(".")
		? `https://github.com/${repository}.git`
		: repository;
}

function trimRepoPath(path: string): string {
	return path.replace(/\/+$/, "").replace(/\.git$/i, "");
}

export function repositoryKey(url: string): string | null {
	const trimmed = url.trim();
	if (!trimmed.includes("://")) {
		const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(trimmed);
		if (!scp?.[1] || !scp[2]) return null;
		return `${scp[1].toLowerCase()}/${trimRepoPath(scp[2].replace(/^\/+/, "")).toLowerCase()}`;
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return null;
	}
	const path = trimRepoPath(decodeURIComponent(parsed.pathname));
	if (parsed.protocol === "file:") return `file:${path}`;
	if (!parsed.hostname || !path) return null;
	return `${parsed.hostname.toLowerCase()}/${path.replace(/^\/+/, "").toLowerCase()}`;
}

export function repositoryFolderName(url: string): string {
	const key = repositoryKey(url) ?? url;
	const last = key.replace(/\/+$/, "").split("/").pop() ?? "";
	const name = last
		.replace(/^file:/, "")
		.replace(/[/\\<>:"|?*\p{Cc}]/gu, "-")
		.replace(/^[. ]+|[. ]+$/g, "");
	return name || "repository";
}

function opened(project: Project, outcome: OpenProjectOutcome): OpenedProject {
	return {
		projectId: project.id,
		name: project.name,
		slug: project.slug,
		path: project.path,
		outcome,
	};
}

function knownProjects(): Project[] {
	return listRecentProjects().filter((project) => !isChatsContainer(project));
}

function openPath(path: string): OpenedProject {
	const wasOpen = new Set(listProjects().map((project) => project.id));
	const project = openProject(path);
	return opened(project, wasOpen.has(project.id) ? "open" : "opened");
}

async function matchesRemote(path: string, key: string, deps: ProjectToolsDeps): Promise<boolean> {
	const urls = await deps.remoteUrls(path).catch(() => []);
	return urls.some((url) => repositoryKey(url) === key);
}

async function findKnownProject(key: string, deps: ProjectToolsDeps): Promise<Project | null> {
	const projects = knownProjects();
	const matches = await Promise.all(
		projects.map((project) => matchesRemote(project.path, key, deps)),
	);
	const hits = projects.filter((_, index) => matches[index]);
	return hits.find((project) => project.closed !== true) ?? hits[0] ?? null;
}

function openLocalFolder(repository: string, cwd: string): OpenedProject {
	const path = repository.startsWith(".")
		? resolve(cwd, repository)
		: resolveProjectPath(repository);
	const status = inspectProjectPath(path);
	if (status.kind !== "repo") {
		throw new CodedError(
			"PROJECT_NOT_REPOSITORY",
			status.kind === "missing"
				? `No folder at ${path}.`
				: `${path} is not a Git repository; open_project does not initialize folders.`,
		);
	}
	return openPath(path);
}

export async function planOpenProject(
	callerSessionId: string,
	params: OpenProjectParams,
	deps: ProjectToolsDeps,
): Promise<OpenProjectPlan> {
	const cwd = deps.callerCwd(callerSessionId);
	const repository = typeof params.repository === "string" ? params.repository.trim() : "";
	if (!repository) throw new Error("Pass a repository: a Git URL, owner/repo, or a host folder.");
	if (isPathLike(repository)) return { kind: "ready", project: openLocalFolder(repository, cwd) };

	const url = validateCloneUrl(expandRepository(repository));
	const key = repositoryKey(url);
	if (key) {
		const known = await findKnownProject(key, deps);
		if (known) {
			const project = known.closed === true ? openProject(known.path) : known;
			return {
				kind: "ready",
				project: opened(project, known.closed === true ? "opened" : "open"),
			};
		}
	}

	const parentPath = getConfig().projectsFolder;
	const parent = resolveProjectPath(parentPath);
	const base = repositoryFolderName(url);
	for (let suffix = 1; suffix <= MAX_NAME_SUFFIX; suffix++) {
		const name = suffix === 1 ? base : `${base}-${suffix}`;
		const status = inspectProjectPath(join(parent, name));
		if (status.kind === "missing") {
			const destination = inspectCloneDestination(parentPath, name);
			const notice = !getConfig().projectsFolderNoticeShown;
			if (notice) markProjectsFolderNoticeShown();
			return { kind: "clone", url, parentPath, name, destination, notice };
		}
		if (status.kind === "repo" && key && (await matchesRemote(join(parent, name), key, deps))) {
			return { kind: "ready", project: openPath(join(parent, name)) };
		}
	}
	throw new CodedError(
		"PROJECT_CLONE_INVALID",
		`Every folder name from ${base} to ${base}-${MAX_NAME_SUFFIX} is taken in ${parent}.`,
	);
}

export async function cloneOpenProject(
	callerSessionId: string,
	plan: ClonePlan,
	deps: ProjectToolsDeps,
	signal?: AbortSignal,
): Promise<OpenedProject> {
	deps.callerCwd(callerSessionId);
	const project = await cloneProject(
		{ url: plan.url, parentPath: plan.parentPath, name: plan.name },
		signal,
	);
	if (!project) throw new Error("Stopped; nothing was cloned.");
	return opened(project, "cloned");
}
