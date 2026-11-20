import {
	lstatSync,
	mkdirSync,
	readdirSync,
	readlinkSync,
	rmdirSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { Container, Project, Workspace } from "@thinkrail/contracts";
import { isWindowsDeviceName } from "@thinkrail/contracts";
import { seedArtifactsDir } from "@thinkrail/shared/artifactsDir";
import { WORKSPACE_CONTEXT_DIR, WORKSPACE_INTERNAL_DIR } from "@thinkrail/shared/paths";
import { dataDir, isContainerId } from "../persistence";
import { trashFile } from "../trash";

const LINKS_DIR = "workspaces";
const LINK_NAME_MAX = 100;
const LINK_TYPE = process.platform === "win32" ? "junction" : "dir";

export function containersRoot(): string {
	return join(dataDir(), "containers");
}

export function containerHome(id: string): string {
	if (!isContainerId(id)) throw new Error(`Not a container id: ${id}`);
	return join(containersRoot(), id);
}

function errorCode(error: unknown): unknown {
	return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function realDirectory(path: string): void {
	if (!lstatSync(path, { throwIfNoEntry: false })) {
		try {
			mkdirSync(path);
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;
		}
	}
	if (!lstatSync(path).isDirectory())
		throw new Error(`Refusing a container folder that is not a real directory: ${path}`);
}

/** One plain path segment: `[A-Za-z0-9._-]`, never `.`/`..`, never a Windows device name. */
export function linkName(slug: string, branch: string): string {
	const name = `${slug}-${branch}`
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/\.{2,}/g, ".")
		.replace(/^[.-]+/, "")
		.slice(0, LINK_NAME_MAX)
		.replace(/[.-]+$/, "");
	if (name === "") return "workspace";
	return isWindowsDeviceName(name) ? `${name}-workspace` : name;
}

/** Member order decides who keeps a contested name; names compare case-insensitively, as macOS and Windows do. */
export function memberLinks(
	container: Container,
	workspaces: readonly Workspace[],
	projects: readonly Project[],
	reserved: ReadonlySet<string> = new Set(),
): Map<string, string> {
	const links = new Map<string, string>();
	const taken = new Set(reserved);
	for (const workspaceId of container.workspaceIds) {
		const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
		if (!workspace || !isAbsolute(workspace.worktreePath)) continue;
		const slug = projects.find((project) => project.id === workspace.projectId)?.slug ?? "";
		const base = linkName(slug, workspace.branch || workspace.name);
		let name = base;
		for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${base}-${n}`;
		taken.add(name.toLowerCase());
		links.set(name, resolve(workspace.worktreePath));
	}
	return links;
}

export function syncContainerHome(
	container: Container,
	workspaces: readonly Workspace[],
	projects: readonly Project[],
): void {
	const home = containerHome(container.id);
	realDirectory(containersRoot());
	realDirectory(home);
	seedArtifactsDir(home);
	const linksDir = join(home, LINKS_DIR);
	realDirectory(linksDir);
	const current = new Map<string, string>();
	const foreign = new Set<string>();
	for (const name of readdirSync(linksDir)) {
		const entry = lstatSync(join(linksDir, name), { throwIfNoEntry: false });
		if (!entry) continue;
		if (entry.isSymbolicLink()) current.set(name, resolve(readlinkSync(join(linksDir, name))));
		else foreign.add(name.toLowerCase());
	}
	const desired = memberLinks(container, workspaces, projects, foreign);
	for (const [name, target] of current) {
		if (desired.get(name) !== target) unlinkSync(join(linksDir, name));
	}
	for (const [name, target] of desired) {
		if (current.get(name) !== target) symlinkSync(target, join(linksDir, name), LINK_TYPE);
	}
}

function removeEmptyDirectory(path: string): boolean {
	if (!lstatSync(path, { throwIfNoEntry: false })?.isDirectory()) return false;
	try {
		rmdirSync(path);
		return true;
	} catch {
		return false;
	}
}

function removeScaffolding(home: string): void {
	const internal = join(home, WORKSPACE_INTERNAL_DIR);
	if (!lstatSync(internal, { throwIfNoEntry: false })?.isDirectory()) return;
	const context = join(home, WORKSPACE_CONTEXT_DIR);
	if (!lstatSync(context, { throwIfNoEntry: false })?.isDirectory()) return;
	const entries = readdirSync(context);
	const gitignore = join(context, ".gitignore");
	if (entries.length !== 1 || entries[0] !== ".gitignore") return;
	if (!lstatSync(gitignore).isFile()) return;
	unlinkSync(gitignore);
	if (removeEmptyDirectory(context)) removeEmptyDirectory(internal);
}

export async function retireContainerHome(id: string): Promise<void> {
	const home = containerHome(id);
	const stat = lstatSync(home, { throwIfNoEntry: false });
	if (!stat) return;
	if (!stat.isDirectory())
		throw new Error(`Refusing a container home that is not a real directory: ${home}`);
	const linksDir = join(home, LINKS_DIR);
	if (lstatSync(linksDir, { throwIfNoEntry: false })?.isDirectory()) {
		for (const name of readdirSync(linksDir)) {
			const path = join(linksDir, name);
			if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(path);
		}
		removeEmptyDirectory(linksDir);
	}
	removeScaffolding(home);
	if (removeEmptyDirectory(home)) return;
	await trashFile(home);
}
