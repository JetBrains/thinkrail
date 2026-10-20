import { homedir, hostname, userInfo } from "node:os";
import { dirname, isAbsolute, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ErrorSource = "host_crash" | "host_logged" | "request" | "ui" | "desktop";

export const EXTERNAL_FRAME = "<external>";
const MAX_MESSAGE_LENGTH = 300;
const MAX_EXCEPTIONS = 5;
const MAX_FRAMES = 60;

export interface ScrubContext {
	home: string;
	username: string;
	hostname: string;
}

export interface FrameRoots {
	appRoot: string;
	remapBase?: string;
	caseInsensitive: boolean;
}

export interface FrameRootOptions {
	appRoot?: string;
	remapBase?: string;
}

function safely<T>(read: () => T, fallback: T): T {
	try {
		return read();
	} catch {
		return fallback;
	}
}

export function defaultScrubContext(): ScrubContext {
	return {
		home: safely(homedir, ""),
		username: safely(() => userInfo().username, ""),
		hostname: safely(hostname, ""),
	};
}

function toSlashes(path: string): string {
	return path.replace(/\\/g, "/");
}

function stripTrailingSlash(path: string): string {
	return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export function detectAppRoot(moduleUrl: string = import.meta.url): string {
	const moduleDir = toSlashes(dirname(fileURLToPath(moduleUrl)));
	const sourceSuffix = "/packages/server/src/analytics";
	return moduleDir.endsWith(sourceSuffix) ? moduleDir.slice(0, -sourceSuffix.length) : moduleDir;
}

export function frameRoots(options: FrameRootOptions = {}): FrameRoots {
	return {
		appRoot: stripTrailingSlash(
			toSlashes(options.appRoot ? resolve(options.appRoot) : detectAppRoot()),
		),
		...(options.remapBase ? { remapBase: options.remapBase } : {}),
		caseInsensitive: process.platform === "win32",
	};
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceLiteral(text: string, literal: string, placeholder: string): string {
	if (literal.length < 3) return text;
	return text.replace(
		new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(literal)}(?![A-Za-z0-9])`, "gi"),
		placeholder,
	);
}

export function scrubMessage(
	input: unknown,
	context: ScrubContext = defaultScrubContext(),
): string {
	let text = typeof input === "string" ? input : "";
	text = (text.split(/\r?\n/, 1)[0] ?? "").trim();
	const jsonStart = text.search(/\{|\[(?=\s*["{[])/);
	if (jsonStart >= 0) text = `${text.slice(0, jsonStart)}<json>`;
	for (const home of new Set([context.home, toSlashes(context.home)])) {
		if (home.length >= 3) text = text.split(home).join("~");
	}
	text = replaceLiteral(text, context.username, "<user>");
	text = replaceLiteral(text, context.hostname, "<host>");
	text = text
		.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
		.replace(/[^\s@<>()'"`]+@[^\s@<>()'"`]+\.[a-z]{2,}/gi, "<email>")
		.replace(/(^|[\s(:=,[])'[^'\n]*'(?=$|[\s).,:;!?\]])/g, "$1<str>")
		.replace(/"[^"\n]*"/g, "<str>")
		.replace(/`[^`\n]*`/g, "<str>")
		.replace(/«[^»\n]*»/g, "<str>")
		.replace(/\b[A-Za-z]:[\\/][^\s,;()]*/g, "<path>")
		.replace(/[^\s,;()<>]*[/\\][^\s,;()<>]*/g, "<path>")
		.replace(/~(?=$|[\s,;:.)])/g, "<path>")
		.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
		.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<ip>")
		.replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{7,}\b/gi, "<hex>")
		.replace(/[A-Za-z0-9_\-+=]{24,}/g, "<token>")
		.replace(/\d{4,}/g, "<n>")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : text;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface NormalizedFrameFile {
	filename: string;
	inApp: boolean;
	web: boolean;
}

export function normalizeFrameFilename(filename: unknown, roots: FrameRoots): NormalizedFrameFile {
	const external = { filename: EXTERNAL_FRAME, inApp: false, web: false };
	if (typeof filename !== "string" || !filename) return external;
	if (/^node:[a-z_/]+$/i.test(filename) || filename === "native") {
		return { filename, inApp: false, web: false };
	}
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(filename) && !/^file:\/\//i.test(filename)) {
		try {
			const url = new URL(filename);
			const local =
				url.protocol === "views:" ||
				((url.protocol === "http:" || url.protocol === "https:") && LOCAL_HOSTS.has(url.hostname));
			if (!local) return { ...external, web: true };
			const views = url.protocol === "views:";
			const clean = `${views ? url.host : ""}${url.pathname}`.replace(/^\/+/, "");
			if (!/^[A-Za-z0-9_\-./@]+$/.test(clean)) return { ...external, web: true };
			return { filename: `${views ? "views" : "web"}/${clean}`, inApp: true, web: true };
		} catch {
			return external;
		}
	}
	const raw = filename.startsWith("file://") ? safely(() => fileURLToPath(filename), "") : filename;
	if (!raw) return external;
	if (!isAbsolute(raw) && !/^[A-Za-z]:[\\/]/.test(raw)) return remappedFrame(raw, roots);
	const absolute = toSlashes(raw);
	const root = `${stripTrailingSlash(toSlashes(roots.appRoot))}/`;
	const within = roots.caseInsensitive
		? absolute.toLowerCase().startsWith(root.toLowerCase())
		: absolute.startsWith(root);
	if (root.length <= 1 || !within) return external;
	const relative = absolute.slice(root.length);
	if (!relative || !/^[A-Za-z0-9_\-./@$~+]+$/.test(relative)) return external;
	return { filename: relative, inApp: !relative.includes("node_modules/"), web: false };
}

function remappedFrame(raw: string, roots: FrameRoots): NormalizedFrameFile {
	const external = { filename: EXTERNAL_FRAME, inApp: false, web: false };
	if (!roots.remapBase) return external;
	const relative = posix.normalize(posix.join(roots.remapBase, toSlashes(raw)));
	if (relative.startsWith("../") || relative.startsWith("/") || relative === "..") return external;
	if (!/^[A-Za-z0-9_\-./@$~+]+\.[cm]?[jt]sx?$/.test(relative)) return external;
	return { filename: relative, inApp: !relative.includes("node_modules/"), web: false };
}

const CHUNK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CHUNK_IDS_PROPERTY = "$thinkrail_chunk_ids";

const SAFE_TYPE = /^[A-Za-z_$][A-Za-z0-9_$.]{0,63}$/;
const SAFE_FUNCTION = /^[A-Za-z0-9_$.<>[\]? -]{1,128}$/;
const SAFE_VALUE = /^[A-Za-z0-9_.:+-]{1,64}$/;
const MECHANISM_TYPES = new Set([
	"generic",
	"onunhandledrejection",
	"onuncaughtexception",
	"onconsole",
	"middleware",
]);
const LEVELS = new Set(["fatal", "error", "warning", "log", "info", "debug"]);
const PASSTHROUGH_KEYS = [
	"app_version",
	"channel",
	"os",
	"arch",
	"build",
	"source",
	"code",
	"scope",
	"request_method",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInt(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function frameChunkId(
	frame: Record<string, unknown>,
	chunkIds: Record<string, unknown>,
): string | undefined {
	const own = frame.chunk_id;
	if (typeof own === "string" && CHUNK_ID.test(own)) return own;
	const mapped = typeof frame.filename === "string" ? chunkIds[frame.filename] : undefined;
	return typeof mapped === "string" && CHUNK_ID.test(mapped) ? mapped : undefined;
}

function sanitizeFrame(
	frame: unknown,
	roots: FrameRoots,
	chunkIds: Record<string, unknown>,
): Record<string, unknown> | null {
	if (!isRecord(frame)) return null;
	const file = normalizeFrameFilename(frame.filename, roots);
	const external = file.filename === EXTERNAL_FRAME;
	const fn = typeof frame.function === "string" ? frame.function : "";
	const out: Record<string, unknown> = {
		platform: file.web ? "web:javascript" : "node:javascript",
		filename: file.filename,
		function: !external && SAFE_FUNCTION.test(fn) ? fn : "?",
		in_app: file.inApp,
	};
	if (!external) {
		const lineno = positiveInt(frame.lineno);
		const colno = positiveInt(frame.colno);
		if (lineno !== undefined) out.lineno = lineno;
		if (colno !== undefined) out.colno = colno;
		const chunkId = frameChunkId(frame, chunkIds);
		if (chunkId) out.chunk_id = chunkId;
	}
	return out;
}

function sanitizeException(
	exception: unknown,
	roots: FrameRoots,
	scrub: ScrubContext,
	chunkIds: Record<string, unknown>,
): Record<string, unknown> | null {
	if (!isRecord(exception)) return null;
	const out: Record<string, unknown> = {
		type:
			typeof exception.type === "string" && SAFE_TYPE.test(exception.type)
				? exception.type
				: "Error",
		value: scrubMessage(exception.value, scrub),
	};
	const mechanism = exception.mechanism;
	if (isRecord(mechanism)) {
		out.mechanism = {
			handled: mechanism.handled === true,
			synthetic: mechanism.synthetic === true,
			type:
				typeof mechanism.type === "string" && MECHANISM_TYPES.has(mechanism.type)
					? mechanism.type
					: "generic",
		};
	}
	const stacktrace = exception.stacktrace;
	if (isRecord(stacktrace) && Array.isArray(stacktrace.frames)) {
		const frames = stacktrace.frames
			.slice(-MAX_FRAMES)
			.map((frame) => sanitizeFrame(frame, roots, chunkIds))
			.filter((frame): frame is Record<string, unknown> => frame !== null);
		out.stacktrace = { type: "raw", frames };
	}
	return out;
}

export function sanitizeExceptionProperties(
	properties: Record<string, unknown>,
	roots: FrameRoots,
	scrub: ScrubContext,
): Record<string, unknown> {
	const list = Array.isArray(properties.$exception_list) ? properties.$exception_list : [];
	const chunkIdsValue = properties[CHUNK_IDS_PROPERTY];
	const chunkIds = isRecord(chunkIdsValue) ? chunkIdsValue : {};
	const handled = typeof properties.handled === "boolean" ? properties.handled : undefined;
	const exceptions = list
		.slice(0, MAX_EXCEPTIONS)
		.map((exception) => sanitizeException(exception, roots, scrub, chunkIds))
		.filter((exception) => exception !== null);
	const root = exceptions[0];
	if (root && handled !== undefined) {
		const mechanism = isRecord(root.mechanism)
			? root.mechanism
			: { synthetic: false, type: "generic" };
		root.mechanism = { ...mechanism, handled };
	}
	const out: Record<string, unknown> = {
		$exception_list: exceptions,
		$process_person_profile: false,
	};
	const level = properties.$exception_level;
	if (typeof level === "string" && LEVELS.has(level)) out.$exception_level = level;
	if (handled !== undefined) out.handled = handled;
	for (const key of PASSTHROUGH_KEYS) {
		const value = properties[key];
		if (typeof value === "string" && SAFE_VALUE.test(value)) out[key] = value;
	}
	return out;
}

export function createExceptionSanitizer(
	options: FrameRootOptions = {},
): (properties: Record<string, unknown>) => Record<string, unknown> {
	const scrub = defaultScrubContext();
	const roots = frameRoots(options);
	return (properties) => sanitizeExceptionProperties(properties, roots, scrub);
}

export function errorCode(error: unknown): string | undefined {
	if (!isRecord(error) && !(error instanceof Error)) return undefined;
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : undefined;
}

export function toV8Stack(stack: string): string {
	return stack
		.split("\n")
		.map((line) => {
			const match = /^\s*(.*?)@(.+):(\d+):(\d+)\s*$/.exec(line);
			if (!match) return line;
			const [, fn, file, lineno, colno] = match;
			return `    at ${fn || "?"} (${file}:${lineno}:${colno})`;
		})
		.join("\n");
}
