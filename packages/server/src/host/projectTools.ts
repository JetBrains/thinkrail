import { join, resolve } from "node:path";
import { isWindowsDeviceName, type Project } from "@thinkrail/contracts";
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
const MAX_FOLDER_NAME_LENGTH = 200;
const GITHUB_SHORTHAND = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/;
const CASE_INSENSITIVE_HOSTS = new Set(["github.com"]);
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
		? `https://github.com/${repository.replace(/\.git$/i, "")}.git`
		: repository;
}

function trimRepoPath(path: string): string {
	return path.replace(/\/+$/, "").replace(/\.git$/i, "");
}

function knownRepositoryPath(path: string): string {
	return trimRepoPath(path.replace(/^\/+/, "")).toLowerCase();
}

function exactPath(path: string): string {
	return path.replace(/\/+$/, "") || "/";
}

export function repositoryKey(url: string): string | null {
	const trimmed = url.trim();
	if (!trimmed.includes("://")) {
		const scp = /^(?:([^@/\s]+)@)?([^:/\s]+):(.+)$/.exec(trimmed);
		if (!scp?.[2] || !scp[3]) return null;
		const host = scp[2].toLowerCase();
		if (CASE_INSENSITIVE_HOSTS.has(host)) return `${host}/${knownRepositoryPath(scp[3])}`;
		return `scp:${scp[1] ? `${scp[1]}@` : ""}${host}:${exactPath(scp[3])}`;
	}
	let parsed: URL;
	let pathname: string;
	try {
		parsed = new URL(trimmed);
		pathname = decodeURIComponent(parsed.pathname);
	} catch {
		return null;
	}
	if (parsed.protocol === "file:") return `file:${exactPath(pathname)}`;
	const host = parsed.hostname.toLowerCase();
	if (!host || exactPath(pathname) === "/") return null;
	if (CASE_INSENSITIVE_HOSTS.has(host)) return `${host}/${knownRepositoryPath(pathname)}`;
	const ssh = parsed.protocol === "ssh:";
	const port = ssh && parsed.port === "22" ? "" : parsed.port;
	const user = ssh && parsed.username ? `${decodeURIComponent(parsed.username)}@` : "";
	return `${parsed.protocol}//${user}${host}${port ? `:${port}` : ""}${exactPath(pathname)}`;
}

export function repositoryFolderName(url: string): string {
	let path: string;
	try {
		path = url.includes("://")
			? decodeURIComponent(new URL(url).pathname)
			: url.slice(url.indexOf(":") + 1);
	} catch {
		path = "";
	}
	const name = (trimRepoPath(path).split("/").pop() ?? "")
		.replace(/[/\\<>:"|?*\p{Cc}]/gu, "-")
		.slice(0, MAX_FOLDER_NAME_LENGTH)
		.replace(/^[. ]+|[. ]+$/g, "");
	if (!name) return "repository";
	return isWindowsDeviceName(name) ? `${name}-repo` : name;
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
	let free: string | null = null;
	for (let suffix = 1; suffix <= MAX_NAME_SUFFIX; suffix++) {
		const name = suffix === 1 ? base : `${base}-${suffix}`;
		const status = inspectProjectPath(join(parent, name));
		if (status.kind === "missing") {
			free ??= name;
			continue;
		}
		if (status.kind === "repo" && key && (await matchesRemote(join(parent, name), key, deps))) {
			return { kind: "ready", project: openPath(join(parent, name)) };
		}
	}
	if (free !== null) {
		const destination = inspectCloneDestination(parentPath, free);
		const notice = !getConfig().projectsFolderNoticeShown;
		if (notice) markProjectsFolderNoticeShown();
		return { kind: "clone", url, parentPath, name: free, destination, notice };
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
