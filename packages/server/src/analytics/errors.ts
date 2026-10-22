import { dirname, isAbsolute, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ErrorSource = "host_crash" | "host_logged" | "request" | "ui" | "desktop";
export type FatalErrorKind = "uncaughtException" | "unhandledRejection";

export const EXTERNAL_FRAME = "<external>";
const MAX_EXCEPTIONS = 5;
const MAX_FRAMES = 60;

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
const CRASH_MECHANISMS = new Map<unknown, string>([
	["uncaughtException", "onuncaughtexception"],
	["unhandledRejection", "onunhandledrejection"],
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
	exception: Record<string, unknown>,
	value: string,
	roots: FrameRoots,
	chunkIds: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {
		type:
			typeof exception.type === "string" && SAFE_TYPE.test(exception.type)
				? exception.type
				: "Error",
		value,
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

function classifier(passthrough: Record<string, unknown>): string {
	return [passthrough.source, passthrough.request_method ?? passthrough.scope, passthrough.code]
		.filter((part): part is string => typeof part === "string")
		.join(" ");
}

export function sanitizeExceptionProperties(
	properties: Record<string, unknown>,
	roots: FrameRoots,
): Record<string, unknown> {
	const passthrough: Record<string, unknown> = {};
	for (const key of PASSTHROUGH_KEYS) {
		const value = properties[key];
		if (typeof value === "string" && SAFE_VALUE.test(value)) passthrough[key] = value;
	}
	const list = Array.isArray(properties.$exception_list) ? properties.$exception_list : [];
	const chunkIdsValue = properties[CHUNK_IDS_PROPERTY];
	const chunkIds = isRecord(chunkIdsValue) ? chunkIdsValue : {};
	const handled = typeof properties.handled === "boolean" ? properties.handled : undefined;
	const summary = classifier(passthrough);
	const exceptions = list
		.filter(isRecord)
		.slice(0, MAX_EXCEPTIONS)
		.map((exception, index) =>
			sanitizeException(exception, index === 0 ? summary : "", roots, chunkIds),
		);
	const root = exceptions[0];
	const crashType =
		passthrough.source === "host_crash" ? CRASH_MECHANISMS.get(passthrough.scope) : undefined;
	if (root && (handled !== undefined || crashType)) {
		const mechanism = isRecord(root.mechanism)
			? root.mechanism
			: { synthetic: false, type: "generic" };
		root.mechanism = {
			...mechanism,
			...(handled !== undefined ? { handled } : {}),
			...(crashType ? { type: crashType } : {}),
		};
	}
	const out: Record<string, unknown> = {
		$exception_list: exceptions,
		$process_person_profile: false,
	};
	const level = properties.$exception_level;
	if (typeof level === "string" && LEVELS.has(level)) out.$exception_level = level;
	if (handled !== undefined) out.handled = handled;
	return { ...out, ...passthrough };
}

export function createExceptionSanitizer(
	options: FrameRootOptions = {},
): (properties: Record<string, unknown>) => Record<string, unknown> {
	const roots = frameRoots(options);
	return (properties) => sanitizeExceptionProperties(properties, roots);
}

const MAX_CAUSE_DEPTH = 4;

export function messageFreeStack(stack: unknown, message: unknown): string | undefined {
	if (typeof stack !== "string" || !stack) return undefined;
	if (typeof message !== "string" || !message) return stack;
	const at = stack.indexOf(message);
	return at < 0 ? undefined : `${stack.slice(0, at)}${stack.slice(at + message.length)}`;
}

export function reportableError(error: unknown, depth = 0): Error {
	const out = new Error();
	out.stack = "";
	if (!(error instanceof Error)) return out;
	out.name = error.name;
	out.stack = messageFreeStack(error.stack, error.message) ?? "";
	if (error.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
		out.cause = reportableError(error.cause, depth + 1);
	}
	return out;
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
