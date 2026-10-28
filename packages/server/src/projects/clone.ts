import { lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Project, WsParams } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { gitAsync } from "../git";
import { openProject, resolveProjectPath } from "./projects";

const CLONE_TIMEOUT_MS = 30 * 60_000;
const activeClones = new Map<string, Map<string, AbortController>>();
type CloneInput = Omit<WsParams<"project.clone">, "operationId">;

function invalid(message: string): never {
	throw new CodedError("PROJECT_CLONE_INVALID", message);
}

function repositoryUrl(value: string): string {
	if (typeof value !== "string" || value.length > 8192) invalid("Enter a Git repository URL.");
	const url = value.trim();
	if (!url || /[\\\s\p{Cc}]/u.test(url)) invalid("Enter a valid Git repository URL.");
	if (!url.includes("://") && /^(?:[\w.-]+@)?[a-zA-Z0-9][\w.-]*:[^\s]+$/.test(url)) {
		if (/^[a-zA-Z]:/.test(url) || url.includes("::"))
			invalid("Use a file URL for a local repository.");
		return url;
	}
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return invalid("Use an HTTP(S), SSH, Git or file repository URL.");
	}
	if (!["https:", "http:", "ssh:", "git:", "file:"].includes(parsed.protocol))
		invalid("Use an HTTP(S), SSH, Git or file repository URL.");
	if (
		parsed.password ||
		parsed.search ||
		parsed.hash ||
		(parsed.username && parsed.protocol !== "ssh:")
	)
		invalid(
			"Use a URL without credentials, query parameters or fragments. Configure credentials in Git on the host.",
		);
	if (
		!parsed.pathname ||
		parsed.pathname === "/" ||
		(parsed.protocol !== "file:" && !parsed.hostname)
	)
		invalid("The URL must include a repository path.");
	if (parsed.protocol === "file:" && parsed.hostname && parsed.hostname !== "localhost")
		invalid("A file URL must refer to a local repository.");
	return url;
}

export function inspectCloneDestination(parentPath: string, requestedName: string): string {
	if (typeof parentPath !== "string" || !parentPath.trim() || parentPath.includes("\0"))
		invalid("Choose a parent folder on the host.");
	if (typeof requestedName !== "string") invalid("Enter a folder name.");
	const name = requestedName.trim();
	if (
		!name ||
		name === "." ||
		name === ".." ||
		name.length > 255 ||
		/[/\\<>:"|?*\p{Cc}]/u.test(name) ||
		/[. ]$/.test(name) ||
		/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
	)
		invalid("Enter a single valid folder name, without path separators.");
	const resolved = resolveProjectPath(parentPath.trim());
	let parent: string;
	try {
		parent = realpathSync.native(resolved);
	} catch {
		invalid("Choose a parent folder on the host.");
	}
	if (!statSync(parent).isDirectory()) invalid("The parent path is not a folder.");
	const path = join(parent, name);
	try {
		lstatSync(path);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return path;
		throw error;
	}
	return invalid(`Destination already exists: ${path}`);
}

function cloneDiagnostic(text: string): string {
	return text
		.replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/]*@/gi, "$1[redacted]@")
		.replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, "$1[redacted]")
		.replace(/\p{Cc}/gu, (character) =>
			character === "\n" || character === "\t" ? character : "",
		);
}

async function removeIncompleteClone(
	path: string,
	reserved: { dev: number; ino: number },
): Promise<void> {
	try {
		const current = lstatSync(path);
		if (current.dev === reserved.dev && current.ino === reserved.ino && current.isDirectory())
			await rm(path, { recursive: true, force: true });
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
		throw new CodedError(
			"PROJECT_CLONE_CLEANUP_FAILED",
			`Could not remove the incomplete clone at ${path}. Remove it manually before retrying.`,
		);
	}
}

export async function cloneProject(
	input: CloneInput,
	signal?: AbortSignal,
): Promise<Project | null> {
	const url = repositoryUrl(input.url);
	if (
		input.depth !== undefined &&
		(!Number.isInteger(input.depth) || input.depth < 1 || input.depth > 2_147_483_647)
	)
		invalid("Clone depth must be a positive integer.");
	const path = inspectCloneDestination(input.parentPath, input.name);
	if (signal?.aborted) return null;
	try {
		mkdirSync(path);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "EEXIST")
			invalid(`Destination already exists: ${path}`);
		throw error;
	}
	const reserved = lstatSync(path);
	try {
		const result = await gitAsync(
			path,
			[
				"-c",
				"protocol.allow=never",
				"-c",
				"protocol.https.allow=always",
				"-c",
				"protocol.http.allow=always",
				"-c",
				"protocol.ssh.allow=always",
				"-c",
				"protocol.git.allow=always",
				"-c",
				"protocol.file.allow=always",
				"clone",
				...(input.depth === undefined ? [] : ["--depth", String(input.depth)]),
				"--",
				url,
				".",
			],
			{
				timeoutMs: CLONE_TIMEOUT_MS,
				network: true,
				redactStderr: cloneDiagnostic,
				...(signal ? { signal } : {}),
			},
		);
		if (!signal?.aborted && !result.ok)
			throw new CodedError(
				"PROJECT_CLONE_FAILED",
				`Git clone failed: ${result.err || "Git exited without a diagnostic."}`,
			);
	} catch (error) {
		await removeIncompleteClone(path, reserved);
		throw error;
	}
	if (signal?.aborted) {
		await removeIncompleteClone(path, reserved);
		return null;
	}
	let checkout: ReturnType<typeof lstatSync> | null = null;
	try {
		checkout = lstatSync(path);
	} catch {
		checkout = null;
	}
	if (!checkout || checkout.dev !== reserved.dev || checkout.ino !== reserved.ino)
		throw new CodedError("PROJECT_CLONE_FAILED", "The clone destination changed during the clone.");
	return openProject(path);
}

export async function startProjectClone(
	input: WsParams<"project.clone">,
	clientKey: string,
): Promise<Project | null> {
	if (typeof input.operationId !== "string" || !/^[\w-]{1,100}$/.test(input.operationId))
		invalid("Invalid clone operation id.");
	let owned = activeClones.get(clientKey);
	if (!owned) {
		owned = new Map();
		activeClones.set(clientKey, owned);
	}
	if (owned.has(input.operationId)) invalid("This clone operation is already running.");
	const controller = new AbortController();
	owned.set(input.operationId, controller);
	try {
		return await cloneProject(input, controller.signal);
	} finally {
		owned.delete(input.operationId);
		if (owned.size === 0) activeClones.delete(clientKey);
	}
}

export function cancelProjectClone(operationId: string, clientKey: string): void {
	activeClones.get(clientKey)?.get(operationId)?.abort();
}
