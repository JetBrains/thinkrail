/** Accepts (`PUT`) one chat attachment, named by its URL-encoded base name, from `CHAT_ATTACHMENTS_PROTOCOL_VERSION`. */
export const CHAT_ATTACHMENTS_ROUTE = "/attachments/";
/** The upload's target workspace; without it the host keeps the file under its data dir. */
export const CHAT_ATTACHMENT_WORKSPACE_PARAM = "workspace";
/** Required on uploads: a non-simple header forces a CORS preflight the host never answers. */
export const CHAT_ATTACHMENT_UPLOAD_HEADER = {
	name: "X-ThinkRail-Request",
	value: "attachment-upload",
} as const;
/** The per-file ceiling for a file attachment (images keep their own per-message budget). */
export const CHAT_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

export const CHAT_ATTACHMENT_ERROR_CODES = [
	"too-large",
	"unknown-workspace",
	"invalid-name",
	"not-a-file",
	"unwritable",
] as const;

export type ChatAttachmentErrorCode = (typeof CHAT_ATTACHMENT_ERROR_CODES)[number];

/** Where the host wrote one attachment: workspace-relative in a workspace, absolute under the data dir. */
export type ChatAttachmentResult =
	| { ok: true; path: string }
	| { ok: false; error: ChatAttachmentErrorCode };

export function isChatAttachmentResult(value: unknown): value is ChatAttachmentResult {
	if (typeof value !== "object" || value === null) return false;
	const ok = Reflect.get(value, "ok");
	if (ok === true) return typeof Reflect.get(value, "path") === "string";
	const error = Reflect.get(value, "error");
	return ok === false && CHAT_ATTACHMENT_ERROR_CODES.some((code) => code === error);
}

const IMAGE_EXTENSION_TYPES: ReadonlyMap<string, string> = new Map([
	["png", "image/png"],
	["jpg", "image/jpeg"],
	["jpeg", "image/jpeg"],
	["gif", "image/gif"],
	["webp", "image/webp"],
	["bmp", "image/bmp"],
	["heic", "image/heic"],
	["heif", "image/heif"],
	["avif", "image/avif"],
	["tif", "image/tiff"],
	["tiff", "image/tiff"],
]);

/** The type a raster image attachment goes to the model as (by MIME type, else extension), or `null` for a file. */
export function attachmentImageType(file: { name: string; type: string }): string | null {
	if (file.type === "image/svg+xml") return null;
	if (file.type.startsWith("image/")) return file.type;
	const dot = file.name.lastIndexOf(".");
	if (dot <= 0) return null;
	return IMAGE_EXTENSION_TYPES.get(file.name.slice(dot + 1).toLowerCase()) ?? null;
}

/** The one "Attached files:" trailer a prompt carries for files the agent reads from disk. */
export function withAttachedFiles(prompt: string, files: readonly string[]): string {
	if (files.length === 0) return prompt;
	const list = `Attached files:\n${files.map((file) => `- ${file}`).join("\n")}`;
	return prompt ? `${prompt}\n\n${list}` : list;
}

const NAUTILUS_HEADER = "x-special/nautilus-clipboard";
const COPY_VERBS = new Set(["copy", "cut"]);

function localFileUri(line: string): string | null {
	let url: URL;
	try {
		url = new URL(line);
	} catch {
		return null;
	}
	if (url.protocol !== "file:" || (url.host !== "" && url.host !== "localhost")) return null;
	try {
		return decodeURIComponent(url.pathname);
	} catch {
		return null;
	}
}

/**
 * The absolute local paths a file manager put on the clipboard as text, or `null` when it is not that:
 * `file://` URIs, optionally after GNOME's `copy`/`cut` line. `barePaths` also takes absolute paths, for
 * the text of a clipboard that offers a file target too.
 */
export function copiedFilePaths(
	text: string,
	{ barePaths = false }: { barePaths?: boolean } = {},
): string[] | null {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line !== "");
	if (lines[0] === NAUTILUS_HEADER) lines.shift();
	if (lines[0] !== undefined && COPY_VERBS.has(lines[0])) lines.shift();
	if (lines.length === 0) return null;
	const paths: string[] = [];
	for (const line of lines) {
		const path = line.startsWith("file:") ? localFileUri(line) : barePaths ? line : null;
		if (path === null || !path.startsWith("/") || path.includes("\0")) return null;
		paths.push(path);
	}
	return paths;
}
