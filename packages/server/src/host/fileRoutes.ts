import { statSync } from "node:fs";
import { extname } from "node:path";
import { WORKSPACE_VIEW_ROUTE } from "@thinkrail/contracts";
import { CONTENT_SNIFF_BYTES, classifyBytes, mimeFromPath, resolveWorktreeFile } from "../fs";
import { readBlobSizeAtAsync, readBlobStreamAtAsync } from "../git";
import { isChatWorkspace, loadWorkspaces } from "../persistence";

export const FILES_PREFIX = "/files/";
export const BLOB_PREFIX = "/blob/";
export const BLOB_SIZE_LIMIT = 64 * 1024 * 1024;
const BLOB_STREAM_TIMEOUT_MS = 5 * 60_000;

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const NO_STORE = { "Cache-Control": "no-store" };
const IMMUTABLE = "public, max-age=31536000, immutable";
const ACTIVE_TYPES = new Set(["text/html", "application/xhtml+xml", "image/svg+xml"]);

function contentHeaders(
	head: Uint8Array,
	path: string,
	cacheControl: string,
	byteLength: number | null,
): Record<string, string> {
	const mime = classifyBytes(head).mime ?? mimeFromPath(path) ?? "application/octet-stream";
	return {
		"Content-Type": mime,
		"Cache-Control": cacheControl,
		...(byteLength === null ? {} : { "Content-Length": String(byteLength) }),
		"X-Content-Type-Options": "nosniff",
		...(ACTIVE_TYPES.has(mime) ? { "Content-Security-Policy": "sandbox; default-src 'none'" } : {}),
	};
}

function notFound(headers?: Record<string, string>): Response {
	return new Response("not found", { status: 404, ...(headers ? { headers } : {}) });
}

function decoded(segment: string): string | null {
	try {
		return decodeURIComponent(segment);
	} catch {
		return null;
	}
}

function head(rest: string): { segment: string; remainder: string } | null {
	const slash = rest.indexOf("/");
	if (slash <= 0) return null;
	const segment = decoded(rest.slice(0, slash));
	const remainder = rest.slice(slash + 1);
	return segment === null || remainder === "" ? null : { segment, remainder };
}

function byteCap(param: string | null): number | null | "invalid" {
	if (param === null) return null;
	const cap = Number(param);
	return /^\d+$/.test(param) && Number.isSafeInteger(cap) ? cap : "invalid";
}

export async function serveWorktreeFile(
	pathname: string,
	maxBytes: string | null = null,
): Promise<Response> {
	const parsed = head(pathname.slice(FILES_PREFIX.length));
	const relPath = parsed === null ? null : decoded(parsed.remainder);
	if (parsed === null || relPath === null) return notFound(NO_STORE);
	const cap = byteCap(maxBytes);
	if (cap === "invalid") return new Response("bad maxBytes", { status: 400, headers: NO_STORE });
	try {
		const abs = resolveWorktreeFile(parsed.segment, relPath);
		const stat = statSync(abs);
		if (!stat.isFile()) return notFound(NO_STORE);
		if (cap !== null && stat.size > cap) {
			return new Response("file too large", { status: 413, headers: NO_STORE });
		}
		const file = Bun.file(abs);
		if (!(await file.exists())) return notFound(NO_STORE);
		const bytes = new Uint8Array(await file.slice(0, CONTENT_SNIFF_BYTES).arrayBuffer());
		return new Response(cap === null ? file : file.slice(0, stat.size), {
			headers: contentHeaders(bytes, relPath, "no-store", stat.size),
		});
	} catch {
		return notFound(NO_STORE);
	}
}

const VIEW_MIME: Readonly<Record<string, string>> = {
	".css": "text/css",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".cjs": "text/javascript",
	".json": "application/json",
	".map": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".ico": "image/x-icon",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".mp4": "video/mp4",
	".webm": "video/webm",
};

const TEXT_TYPES = new Set(["text/javascript", "application/json", "image/svg+xml"]);

export function viewPolicy(base: string): string {
	return [
		"sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
		"default-src 'none'",
		`script-src ${base} 'unsafe-inline'`,
		`style-src ${base} 'unsafe-inline'`,
		`img-src ${base} data: blob:`,
		`font-src ${base} data:`,
		`media-src ${base} data: blob:`,
		`frame-src ${base}`,
		"connect-src 'none'",
		"worker-src 'none'",
		"object-src 'none'",
		`base-uri ${base}`,
		"form-action 'none'",
	].join("; ");
}

export async function serveWorktreeView(method: string, url: URL): Promise<Response> {
	if (method !== "GET" && method !== "HEAD") {
		return new Response("method not allowed", {
			status: 405,
			headers: { ...NO_STORE, Allow: "GET, HEAD" },
		});
	}
	const parsed = head(url.pathname.slice(WORKSPACE_VIEW_ROUTE.length));
	const relPath = parsed === null ? null : decoded(parsed.remainder);
	if (parsed === null || relPath === null) return notFound(NO_STORE);
	try {
		const abs = resolveWorktreeFile(parsed.segment, relPath);
		const stat = statSync(abs);
		if (!stat.isFile()) return notFound(NO_STORE);
		const file = Bun.file(abs);
		if (!(await file.exists())) return notFound(NO_STORE);
		const bytes = new Uint8Array(await file.slice(0, CONTENT_SNIFF_BYTES).arrayBuffer());
		const mime =
			classifyBytes(bytes).mime ??
			VIEW_MIME[extname(relPath).toLowerCase()] ??
			mimeFromPath(relPath) ??
			"application/octet-stream";
		const text = mime.startsWith("text/") || TEXT_TYPES.has(mime);
		const base = `${url.origin}${WORKSPACE_VIEW_ROUTE}${encodeURIComponent(parsed.segment)}/`;
		return new Response(file, {
			headers: {
				"Content-Type": text ? `${mime}; charset=utf-8` : mime,
				...NO_STORE,
				"Content-Length": String(stat.size),
				"X-Content-Type-Options": "nosniff",
				...(ACTIVE_TYPES.has(mime) ? { "Content-Security-Policy": viewPolicy(base) } : {}),
			},
		});
	} catch {
		return notFound(NO_STORE);
	}
}

export async function serveBlob(pathname: string, signal?: AbortSignal): Promise<Response> {
	const workspace = head(pathname.slice(BLOB_PREFIX.length));
	const blob = workspace === null ? null : head(workspace.remainder);
	const relPath = blob === null ? null : decoded(blob.remainder);
	if (workspace === null || blob === null || relPath === null) return notFound();
	if (!OID.test(blob.segment)) return notFound();
	try {
		const record = loadWorkspaces().find((candidate) => candidate.id === workspace.segment);
		if (record === undefined || isChatWorkspace(record)) return notFound();
		const { worktreePath } = record;
		resolveWorktreeFile(workspace.segment, relPath);
		const size = await readBlobSizeAtAsync(worktreePath, blob.segment, relPath);
		if (size === null) return notFound();
		if (size > BLOB_SIZE_LIMIT) return new Response("blob too large", { status: 413 });
		const stream = await readBlobStreamAtAsync(worktreePath, blob.segment, relPath, {
			timeoutMs: BLOB_STREAM_TIMEOUT_MS,
			...(signal ? { signal } : {}),
		});
		if (stream === null) return notFound();
		return new Response(stream.body, {
			headers: contentHeaders(stream.head, relPath, IMMUTABLE, null),
		});
	} catch {
		return notFound();
	}
}
