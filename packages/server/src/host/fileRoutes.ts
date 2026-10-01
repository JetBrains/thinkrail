import { statSync } from "node:fs";
import { resolveWorktreeFile, resourceMeta } from "../fs";
import { readBlobBytesAtAsync } from "../git";
import { loadWorkspaces } from "../persistence";

export const FILES_PREFIX = "/files/";
export const BLOB_PREFIX = "/blob/";

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const NO_STORE = { "Cache-Control": "no-store" };
const IMMUTABLE = "public, max-age=31536000, immutable";
const ACTIVE_TYPES = new Set(["text/html", "application/xhtml+xml", "image/svg+xml"]);

function contentHeaders(
	bytes: Uint8Array,
	path: string,
	cacheControl: string,
): Record<string, string> {
	const mime = resourceMeta(bytes, path).mime ?? "application/octet-stream";
	return {
		"Content-Type": mime,
		"Cache-Control": cacheControl,
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

export async function serveWorktreeFile(pathname: string): Promise<Response> {
	const parsed = head(pathname.slice(FILES_PREFIX.length));
	const relPath = parsed === null ? null : decoded(parsed.remainder);
	if (parsed === null || relPath === null) return notFound(NO_STORE);
	try {
		const abs = resolveWorktreeFile(parsed.segment, relPath);
		if (!statSync(abs).isFile()) return notFound(NO_STORE);
		const file = Bun.file(abs);
		if (!(await file.exists())) return notFound(NO_STORE);
		const bytes = new Uint8Array(await file.arrayBuffer());
		return new Response(bytes, { headers: contentHeaders(bytes, relPath, "no-store") });
	} catch {
		return notFound(NO_STORE);
	}
}

export async function serveBlob(pathname: string): Promise<Response> {
	const workspace = head(pathname.slice(BLOB_PREFIX.length));
	const blob = workspace === null ? null : head(workspace.remainder);
	const relPath = blob === null ? null : decoded(blob.remainder);
	if (workspace === null || blob === null || relPath === null) return notFound();
	if (!OID.test(blob.segment)) return notFound();
	try {
		const worktreePath = loadWorkspaces().find(
			(candidate) => candidate.id === workspace.segment,
		)?.worktreePath;
		if (worktreePath === undefined) return notFound();
		resolveWorktreeFile(workspace.segment, relPath);
		const bytes = await readBlobBytesAtAsync(worktreePath, blob.segment, relPath);
		if (bytes === null) return notFound();
		return new Response(new Uint8Array(bytes), {
			headers: contentHeaders(bytes, relPath, IMMUTABLE),
		});
	} catch {
		return notFound();
	}
}
