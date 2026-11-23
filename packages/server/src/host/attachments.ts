import { constants, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { type FileHandle, open, rm } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, sep } from "node:path";
import {
	CHAT_ATTACHMENT_MAX_BYTES,
	CHAT_ATTACHMENT_UPLOAD_HEADER,
	CHAT_ATTACHMENT_WORKSPACE_PARAM,
	CHAT_ATTACHMENTS_ROUTE,
	type ChatAttachmentErrorCode,
	type ChatAttachmentResult,
	hasControlCharacter,
} from "@thinkrail/contracts";
import { seedArtifactsDir } from "@thinkrail/shared/artifactsDir";
import { WORKSPACE_CONTEXT_DIR } from "@thinkrail/shared/paths";
import { logger } from "../log";
import { dataDir } from "../persistence";
import { notifyWorkspacePathsChanged } from "../watch";
import { getWorkspace } from "../workspaces";
import { assertChatOpen } from "./chats";

const log = logger("host");

export const ATTACHMENTS_DIR = `${WORKSPACE_CONTEXT_DIR}/attachments`;
const NAME_MAX_BYTES = 255;
const MAX_NAME_ATTEMPTS = 1_000;
const MAX_NAME_BYTES = NAME_MAX_BYTES - `-${MAX_NAME_ATTEMPTS}`.length;
const MAX_EXTENSION_BYTES = 32;
const CREATE_EXCLUSIVE =
	constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
const READ_NONBLOCKING = constants.O_RDONLY | constants.O_NONBLOCK;
const RESERVED = /[<>:"|?*]/g;
const ERROR_STATUS: Record<ChatAttachmentErrorCode, number> = {
	"too-large": 413,
	"unknown-workspace": 404,
	"invalid-name": 400,
	"not-a-file": 422,
	unwritable: 500,
};

interface AttachmentTarget {
	dir: string;
	listed: (fileName: string) => string;
	written: (fileName: string) => void;
}

class AttachmentRefused extends Error {
	readonly code: ChatAttachmentErrorCode;

	constructor(code: ChatAttachmentErrorCode) {
		super(code);
		this.code = code;
	}
}

function errorCode(error: unknown): unknown {
	return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function isContained(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function utf8Prefix(text: string, maxBytes: number): string {
	let bytes = 0;
	let end = 0;
	for (const char of text) {
		bytes += Buffer.byteLength(char);
		if (bytes > maxBytes) break;
		end += char.length;
	}
	return text.slice(0, end);
}

export function attachmentFileName(raw: string): string | null {
	const flat = raw.replaceAll("\\", "/").split("/").at(-1) ?? "";
	const name = flat.replace(RESERVED, "_").trim();
	if (name === "" || name === "." || name === ".." || hasControlCharacter(name)) return null;
	if (Buffer.byteLength(name) <= MAX_NAME_BYTES) return name;
	const fullExtension = extname(name);
	const extension = utf8Prefix(fullExtension, MAX_EXTENSION_BYTES);
	const stem = name.slice(0, name.length - fullExtension.length);
	return `${utf8Prefix(stem, MAX_NAME_BYTES - Buffer.byteLength(extension))}${extension}`;
}

export function attachmentCandidate(name: string, attempt: number): string {
	if (attempt === 0) return name;
	const extension = extname(name);
	const stem = extension === name ? name : name.slice(0, name.length - extension.length);
	return `${stem}-${attempt + 1}${extension}`;
}

function realDirectory(path: string): void {
	if (!lstatSync(path, { throwIfNoEntry: false })) {
		try {
			mkdirSync(path);
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;
		}
	}
	if (!lstatSync(path).isDirectory()) throw new Error(`Not a real directory: ${path}`);
}

function workspaceTarget(workspaceId: string): AttachmentTarget {
	let worktreePath: string;
	try {
		worktreePath = getWorkspace(workspaceId).worktreePath;
		assertChatOpen(workspaceId);
	} catch {
		throw new AttachmentRefused("unknown-workspace");
	}
	const dir = join(seedArtifactsDir(worktreePath), "attachments");
	realDirectory(dir);
	if (!isContained(realpathSync(worktreePath), realpathSync(dir))) {
		throw new Error("The attachments folder escapes the worktree");
	}
	return {
		dir,
		listed: (fileName) => `${ATTACHMENTS_DIR}/${fileName}`,
		written: (fileName) =>
			notifyWorkspacePathsChanged(workspaceId, [`${ATTACHMENTS_DIR}/${fileName}`]),
	};
}

function dataDirTarget(): AttachmentTarget {
	const dir = join(dataDir(), "attachments");
	mkdirSync(dataDir(), { recursive: true });
	realDirectory(dir);
	return { dir, listed: (fileName) => join(dir, fileName), written: () => undefined };
}

function attachmentTarget(workspaceId: string | undefined): AttachmentTarget {
	return workspaceId === undefined ? dataDirTarget() : workspaceTarget(workspaceId);
}

async function createExclusive(
	dir: string,
	name: string,
): Promise<{ handle: FileHandle; fileName: string }> {
	for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
		const fileName = attachmentCandidate(name, attempt);
		try {
			return { handle: await open(join(dir, fileName), CREATE_EXCLUSIVE, 0o644), fileName };
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;
		}
	}
	throw new Error(`No free name for the attachment ${name}`);
}

async function writeCapped(
	handle: FileHandle,
	body: AsyncIterable<Uint8Array> | null,
): Promise<boolean> {
	let size = 0;
	for await (const chunk of body ?? []) {
		size += chunk.byteLength;
		if (size > CHAT_ATTACHMENT_MAX_BYTES) return false;
		await handle.write(chunk);
	}
	return true;
}

async function store(
	target: AttachmentTarget,
	name: string,
	body: AsyncIterable<Uint8Array> | null,
): Promise<ChatAttachmentResult> {
	const { handle, fileName } = await createExclusive(target.dir, name);
	const path = join(target.dir, fileName);
	let complete = false;
	try {
		complete = await writeCapped(handle, body);
	} finally {
		await handle.close();
		if (!complete) await rm(path, { force: true });
	}
	if (!complete) return { ok: false, error: "too-large" };
	target.written(fileName);
	return { ok: true, path: target.listed(fileName) };
}

function refusal(error: unknown, action: string): ChatAttachmentResult {
	if (error instanceof AttachmentRefused) return { ok: false, error: error.code };
	log.warn(`could not ${action} an attachment`, error);
	return { ok: false, error: "unwritable" };
}

export async function saveAttachment(
	workspaceId: string | undefined,
	rawName: string,
	body: AsyncIterable<Uint8Array> | null,
): Promise<ChatAttachmentResult> {
	const name = attachmentFileName(rawName);
	if (name === null) return { ok: false, error: "invalid-name" };
	try {
		return await store(attachmentTarget(workspaceId), name, body);
	} catch (error) {
		return refusal(error, "save");
	}
}

export async function copyLocalAttachment(
	workspaceId: string | undefined,
	source: string,
): Promise<ChatAttachmentResult> {
	if (!isAbsolute(source)) return { ok: false, error: "not-a-file" };
	const name = attachmentFileName(basename(source));
	if (name === null) return { ok: false, error: "invalid-name" };
	let handle: FileHandle;
	try {
		handle = await open(source, READ_NONBLOCKING);
	} catch {
		return { ok: false, error: "not-a-file" };
	}
	try {
		const stats = await handle.stat();
		if (!stats.isFile()) return { ok: false, error: "not-a-file" };
		if (stats.size > CHAT_ATTACHMENT_MAX_BYTES) return { ok: false, error: "too-large" };
		return await store(
			attachmentTarget(workspaceId),
			name,
			handle.createReadStream({ autoClose: false }),
		);
	} catch (error) {
		return refusal(error, "copy");
	} finally {
		await handle.close().catch(() => undefined);
	}
}

function plain(status: number, text: string, headers?: Record<string, string>): Response {
	return new Response(text, { status, ...(headers ? { headers } : {}) });
}

function requestedName(pathname: string): string | null {
	try {
		return decodeURIComponent(pathname.slice(CHAT_ATTACHMENTS_ROUTE.length));
	} catch {
		return null;
	}
}

export async function serveChatAttachments(req: Request, url: URL): Promise<Response> {
	if (req.method !== "PUT") return plain(405, "method not allowed", { Allow: "PUT" });
	if (req.headers.get(CHAT_ATTACHMENT_UPLOAD_HEADER.name) !== CHAT_ATTACHMENT_UPLOAD_HEADER.value) {
		return plain(403, "forbidden");
	}
	const name = requestedName(url.pathname);
	const workspaceId = url.searchParams.get(CHAT_ATTACHMENT_WORKSPACE_PARAM) ?? undefined;
	const result: ChatAttachmentResult =
		Number(req.headers.get("Content-Length") ?? 0) > CHAT_ATTACHMENT_MAX_BYTES
			? { ok: false, error: "too-large" }
			: await saveAttachment(workspaceId, name ?? "", req.body);
	return Response.json(result, { status: result.ok ? 200 : ERROR_STATUS[result.error] });
}
