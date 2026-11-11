import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmdirSync, rmSync, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import type {
	McpProjectOverride,
	McpToolGrant,
	Project,
	ProjectPathStatus,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { canonicalPath, git, gitAsync, INDEX_WRITE_TIMEOUT_MS, throwOnTimeout } from "../git";
import { landsInChatsRoot, loadProjects, loadWorkspaces, saveProjects } from "../persistence";

type ProjectPublisher = (project: Project) => void;

let publishProject: ProjectPublisher | null = null;

export function setProjectPublisher(fn: ProjectPublisher | null): void {
	publishProject = fn;
}

function emit(project: Project): void {
	publishProject?.(project);
}

let guardProjectPath: ((path: string) => void) | null = null;

export function setProjectPathGuard(fn: ((path: string) => void) | null): void {
	guardProjectPath = fn;
}

export function assertProjectPathAllowed(path: string): void {
	guardProjectPath?.(path);
}

export function resolveProjectPath(path: string): string {
	const home =
		(process.platform === "win32" ? process.env.USERPROFILE : process.env.HOME) || homedir();
	const underHome =
		path.startsWith("~/") || (process.platform === "win32" && path.startsWith("~\\"));
	const expanded = path === "~" ? home : underHome ? join(home, path.slice(2)) : path;
	if (!isAbsolute(expanded)) {
		const homeForms = process.platform === "win32" ? "~/ or ~\\" : "~/";
		throw new Error(`Project path must be absolute or start with ${homeForms}: ${path}`);
	}
	return resolve(expanded);
}

function gitToplevel(path: string): string | null {
	const result = git(path, ["rev-parse", "--show-toplevel"], {
		action: "read the repository root",
	});
	if (!result.ok && /dubious ownership/i.test(result.err))
		throw new Error(`Git refused to open ${path}:\n${result.err}`);
	return result.ok && result.out ? resolve(result.out) : null;
}

function gitStepFailed(step: string, path: string, err: string): Error {
	return new Error(err ? `${step} failed: ${path}\n${err}` : `${step} failed: ${path}`);
}

function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "project"
	);
}

function uniqueSlug(base: string, taken: Set<string>): string {
	if (!taken.has(base)) return base;
	let n = 2;
	while (taken.has(`${base}-${n}`)) n += 1;
	return `${base}-${n}`;
}

function ensureSlugs(projects: Project[]): boolean {
	const taken = new Set(projects.map((p) => p.slug).filter(Boolean));
	let changed = false;
	for (const project of projects) {
		if (!project.slug) {
			project.slug = uniqueSlug(slugify(project.name), taken);
			taken.add(project.slug);
			changed = true;
		}
	}
	return changed;
}

/** Whether pi itself already trusts a path; seeds a newly added project's pi-level trust. */
export type PiTrustSeed = (path: string) => boolean;
let piTrustSeed: PiTrustSeed | null = null;

export function setPiTrustSeed(seed: PiTrustSeed | null): void {
	piTrustSeed = seed;
}

export function getProjects(): Project[] {
	const projects = loadProjects();
	if (ensureSlugs(projects)) saveProjects(projects);
	return projects;
}

/** The one reserved-root door check, before any filesystem or git side effect; the path keeps its spelling. */
export function assertOutsideChatsRoot(path: string, use = "opened as a project"): void {
	if (landsInChatsRoot(path)) {
		throw new CodedError(
			"CHATS_CONTAINER",
			`Chats without a project live here; this folder cannot be ${use}.`,
		);
	}
}

const bootstraps = new Map<string, Promise<void>>();

function pendingBootstrap(path: string): Promise<void> | undefined {
	return bootstraps.get(canonicalPath(path));
}

function refuseWhileBootstrapping(path: string, own?: string): void {
	const key = canonicalPath(path);
	if (key !== own && bootstraps.has(key))
		throw new CodedError(
			"PROJECT_BOOTSTRAPPING",
			`This folder is still being set up as a git repository: ${path}`,
		);
}

async function holdingBootstrap<T>(path: string, run: (own: string) => Promise<T>): Promise<T> {
	const own = canonicalPath(path);
	const settled = Promise.withResolvers<void>();
	bootstraps.set(own, settled.promise);
	try {
		return await run(own);
	} finally {
		bootstraps.delete(own);
		settled.resolve();
	}
}

export function openProject(inputPath: string, displayName?: string): Project {
	return openResolvedProject(resolveProjectPath(inputPath), displayName);
}

function openResolvedProject(path: string, displayName?: string, ownBootstrap?: string): Project {
	assertProjectPathAllowed(path);
	assertOutsideChatsRoot(path);
	refuseWhileBootstrapping(path, ownBootstrap);
	const root = gitToplevel(path);
	if (!root) throw new CodedError("NOT_GIT", `Not a git repository: ${path}`);
	refuseWhileBootstrapping(root, ownBootstrap);

	const projects = getProjects();
	const existing = projects.find((p) => p.path === root);
	if (existing) {
		delete existing.closed;
		existing.lastOpened = Date.now();
		saveProjects(projects);
		emit(existing);
		return existing;
	}

	const wanted = canonicalPath(root);
	if (loadWorkspaces().some((ws) => canonicalPath(ws.worktreePath) === wanted))
		throw new CodedError(
			"ALREADY_OPEN",
			`This folder is already open in ThinkRail as a workspace: ${root}`,
		);

	const taken = new Set(projects.map((p) => p.slug));
	const label = displayName?.replace(/\s+/g, " ").trim();
	const project: Project = {
		id: randomUUID(),
		name: label && label.length <= PROJECT_NAME_MAX_LENGTH ? label : basename(root),
		path: root,
		slug: uniqueSlug(slugify(basename(root)), taken),
		lastOpened: Date.now(),
		piResourceTrust: piTrustSeed?.(root) ? "granted" : "untrusted",
	};
	projects.push(project);
	saveProjects(projects);
	emit(project);
	return project;
}

function newestFirst(projects: Project[]): Project[] {
	return projects.sort((a, b) => b.lastOpened - a.lastOpened);
}

export function listProjects(): Project[] {
	return newestFirst(getProjects().filter((project) => project.closed !== true));
}

const goneFolders = new Set<string>();
const folderChecks = new Map<string, Promise<void>>();

function checkFolder(path: string): Promise<void> {
	const pending = folderChecks.get(path);
	if (pending) return pending;
	const check = stat(path)
		.then(
			(stats) => !stats.isDirectory(),
			(error) => {
				const code = (error as { code?: string }).code;
				return code === "ENOENT" || code === "ENOTDIR";
			},
		)
		.then((gone) => {
			if (gone) goneFolders.add(path);
			else goneFolders.delete(path);
			folderChecks.delete(path);
		});
	folderChecks.set(path, check);
	return check;
}

export async function refreshRecentProjectFolders(budgetMs: number): Promise<void> {
	const checks = getProjects()
		.filter((project) => project.closed === true)
		.map((project) => checkFolder(project.path));
	let timer: ReturnType<typeof setTimeout> | undefined;
	const budget = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, budgetMs);
	});
	await Promise.race([Promise.all(checks), budget]);
	clearTimeout(timer);
}

export function listRecentProjects(): Project[] {
	return newestFirst(
		getProjects().filter((project) => project.closed !== true || !goneFolders.has(project.path)),
	);
}

export function closeProject(id: string): Project {
	const projects = getProjects();
	const project = projects.find((candidate) => candidate.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	project.closed = true;
	saveProjects(projects);
	emit(project);
	return project;
}

const PROJECT_NAME_MAX_LENGTH = 100;

export function renameProject(id: string, requestedName: string): Project {
	const name = requestedName.replace(/\s+/g, " ").trim();
	if (!name || name.length > PROJECT_NAME_MAX_LENGTH)
		throw new Error(`Invalid project name: ${requestedName}`);
	const projects = getProjects();
	const project = projects.find((candidate) => candidate.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	if (project.name === name) return project;
	project.name = name;
	saveProjects(projects);
	emit(project);
	return project;
}

export function setProjectTrust(
	id: string,
	trusted: boolean,
	acknowledgedSkills?: string[],
	options: { resources?: boolean } = {},
): Project {
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	project.trusted = trusted;
	if (!trusted) project.piResourceTrust = "untrusted";
	else if (options.resources === true) project.piResourceTrust = "granted";
	if (acknowledgedSkills !== undefined) project.acknowledgedSkills = acknowledgedSkills;
	saveProjects(projects);
	emit(project);
	return project;
}

export function approveProjectMcpServer(id: string, name: string, fingerprint: string): Project {
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	project.mcpApprovals = { ...project.mcpApprovals, [name]: fingerprint };
	saveProjects(projects);
	return project;
}

export function setProjectMcpOverride(
	id: string,
	name: string,
	patch: McpProjectOverride | null,
): Project {
	if (patch !== null) {
		if (patch.enabled !== undefined && typeof patch.enabled !== "boolean") {
			throw new CodedError("MCP_CONFIG_INVALID", "MCP server enabled must be a boolean");
		}
		if (
			patch.exposure !== undefined &&
			patch.exposure !== "deferred" &&
			patch.exposure !== "direct" &&
			patch.exposure !== "hidden"
		) {
			throw new CodedError(
				"MCP_CONFIG_INVALID",
				"MCP server exposure must be deferred, direct or hidden",
			);
		}
	}
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	const overrides: Record<string, McpProjectOverride> = { ...project.mcpOverrides };
	if (patch === null) {
		delete overrides[name];
	} else {
		if (patch.enabled === undefined && patch.exposure === undefined) return project;
		const override = {
			...(Object.hasOwn(overrides, name) ? overrides[name] : {}),
			...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
			...(patch.exposure !== undefined ? { exposure: patch.exposure } : {}),
		};
		Object.defineProperty(overrides, name, {
			value: override,
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	if (Object.keys(overrides).length === 0) delete project.mcpOverrides;
	else project.mcpOverrides = overrides;
	saveProjects(projects);
	return project;
}

function setOwn<T>(record: Record<string, T>, key: string, value: T): void {
	Object.defineProperty(record, key, {
		value,
		enumerable: true,
		configurable: true,
		writable: true,
	});
}

export function grantProjectMcpTool(
	id: string,
	name: string,
	target: string,
	tool: string,
): Project {
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	const grants: Record<string, McpToolGrant> = { ...project.mcpToolGrants };
	const current = Object.hasOwn(grants, name) ? grants[name] : undefined;
	const tools = current?.target === target ? current.tools.filter((t) => t !== tool) : [];
	setOwn(grants, name, { target, tools: [...tools, tool] });
	project.mcpToolGrants = grants;
	saveProjects(projects);
	return project;
}

export function revokeProjectMcpTool(id: string, name: string, tool: string): Project {
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	const grants: Record<string, McpToolGrant> = { ...project.mcpToolGrants };
	const current = Object.hasOwn(grants, name) ? grants[name] : undefined;
	if (!current) return project;
	const tools = current.tools.filter((t) => t !== tool);
	if (tools.length === 0) delete grants[name];
	else setOwn(grants, name, { target: current.target, tools });
	if (Object.keys(grants).length === 0) delete project.mcpToolGrants;
	else project.mcpToolGrants = grants;
	saveProjects(projects);
	return project;
}

export function acknowledgeProjectSkills(id: string, names: string[]): Project {
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	project.acknowledgedSkills = [...new Set([...(project.acknowledgedSkills ?? []), ...names])];
	saveProjects(projects);
	return project;
}

export function setProjectSkillEnabled(id: string, name: string, enabled: boolean): Project {
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	const disabled = new Set(project.disabledSkills ?? []);
	if (enabled) disabled.delete(name);
	else disabled.add(name);
	project.disabledSkills = [...disabled];
	saveProjects(projects);
	return project;
}

export function setProjectGroupEnabled(id: string, group: string, enabled: boolean): Project {
	const projects = getProjects();
	const project = projects.find((p) => p.id === id);
	if (!project) throw new Error(`Unknown project: ${id}`);
	const disabled = new Set(project.disabledGroups ?? []);
	const on = new Set(project.enabledGroups ?? []);
	if (enabled) {
		disabled.delete(group);
		on.add(group);
	} else {
		disabled.add(group);
		on.delete(group);
	}
	project.disabledGroups = [...disabled];
	project.enabledGroups = [...on];
	saveProjects(projects);
	return project;
}

export function isProjectTrusted(id: string): boolean {
	return getProjects().find((p) => p.id === id)?.trusted === true;
}

function inspectResolvedProjectPath(path: string): ProjectPathStatus {
	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(path);
	} catch {
		return { kind: "missing" };
	}
	if (!stat.isDirectory()) return { kind: "notDirectory" };
	return { kind: gitToplevel(path) ? "repo" : "initable" };
}

export function inspectProjectPath(inputPath: string): ProjectPathStatus {
	const path = resolveProjectPath(inputPath);
	assertOutsideChatsRoot(path);
	return inspectResolvedProjectPath(path);
}

export async function initProject(inputPath: string): Promise<Project> {
	const path = resolveProjectPath(inputPath);
	assertProjectPathAllowed(path);
	assertOutsideChatsRoot(path);
	const pending = pendingBootstrap(path);
	if (pending) {
		await pending;
		return initProject(inputPath);
	}
	const status = inspectResolvedProjectPath(path);
	if (status.kind === "missing") throw new Error(`No such folder: ${path}`);
	if (status.kind === "notDirectory") throw new Error(`Not a folder: ${path}`);
	if (status.kind === "repo") return openProject(path);
	return holdingBootstrap(path, async (own) => {
		await bootstrapRepository(path);
		return openResolvedProject(path, undefined, own);
	});
}

export async function createProject(
	parentPath: string,
	requestedName: string,
	displayName?: string,
): Promise<Project> {
	const name = requestedName.trim();
	if (!name || name === "." || name === ".." || /[/\\\0]/.test(name)) {
		throw new Error(`Invalid project folder name: ${requestedName}`);
	}
	const parent = resolveProjectPath(parentPath);
	const path = join(parent, name);
	assertProjectPathAllowed(path);
	assertOutsideChatsRoot(path);
	mkdirSync(parent, { recursive: true });
	const pending = pendingBootstrap(path);
	if (pending) {
		await pending;
		return createProject(parentPath, requestedName, displayName);
	}
	let created = false;
	try {
		if (!statSync(path).isDirectory()) throw new Error(`Not a folder: ${path}`);
		if (readdirSync(path).length > 0)
			throw new Error(`Folder already exists and isn't empty: ${path}`);
	} catch (err) {
		if (!(err instanceof Error && "code" in err && err.code === "ENOENT")) throw err;
		mkdirSync(path);
		created = true;
	}
	return holdingBootstrap(path, async (own) => {
		try {
			await bootstrapRepository(path);
			return openResolvedProject(path, displayName, own);
		} catch (err) {
			rmSync(join(path, ".git"), { recursive: true, force: true });
			if (created && readdirSync(path).length === 0) rmdirSync(path);
			throw err;
		}
	});
}

async function bootstrapStep(
	path: string,
	step: string,
	args: string[],
	opts: { timeoutMs?: number } = {},
): Promise<void> {
	const result = throwOnTimeout(await gitAsync(path, args, opts), `run ${step}`);
	if (!result.ok) throw gitStepFailed(step, path, result.err);
}

async function bootstrapRepository(path: string): Promise<void> {
	const gitDir = join(path, ".git");
	const createdGitDir = !existsSync(gitDir);
	const indexWrite = { timeoutMs: INDEX_WRITE_TIMEOUT_MS ?? Number.POSITIVE_INFINITY };
	try {
		await bootstrapStep(path, "git init", ["init", "-b", "main"]);
		await bootstrapStep(path, "git add", ["add", "-A"], indexWrite);

		const identity: string[] = [];
		const identityProbe = { action: "read the git identity" };
		if (!git(path, ["config", "user.name"], identityProbe).out)
			identity.push("-c", "user.name=ThinkRail");
		if (!git(path, ["config", "user.email"], identityProbe).out)
			identity.push("-c", "user.email=thinkrail@localhost");
		const noAutoGc = ["-c", "maintenance.auto=false", "-c", "gc.auto=0"];
		await bootstrapStep(
			path,
			"git commit",
			[...identity, ...noAutoGc, "commit", "--allow-empty", "-m", "Initial commit"],
			indexWrite,
		);
	} catch (err) {
		if (createdGitDir) rmSync(gitDir, { recursive: true, force: true });
		throw err;
	}
}
