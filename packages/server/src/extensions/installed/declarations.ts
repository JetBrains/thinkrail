import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

export type ExtensionSourceKind = "npm" | "git" | "folder";

export type DeclarationsRead =
	| { ok: true; sources: string[]; fields: Record<string, unknown> }
	| { ok: false; error: string };

const GIT_URL = /^(?:https?|ssh|git):\/\//i;

export function extensionSourceKind(source: string): ExtensionSourceKind | undefined {
	if (source.startsWith("npm:") && source.length > 4) return "npm";
	if (source.startsWith("git:") || GIT_URL.test(source)) return "git";
	if (source.startsWith("file://")) return "folder";
	if (isAbsolute(source) || source === "~" || source.startsWith("~/")) return "folder";
	return undefined;
}

export function folderOf(source: string): string {
	if (source.startsWith("file://")) return fileURLToPath(source);
	const expanded =
		source === "~" || source.startsWith("~/") ? join(homedir(), source.slice(1)) : source;
	return normalize(expanded);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readDeclarations(path: string): DeclarationsRead {
	if (!existsSync(path)) return { ok: true, sources: [], fields: {} };
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
	} catch (error) {
		return { ok: false, error: `extensions.json is not valid JSON: ${(error as Error).message}` };
	}
	if (!isRecord(raw))
		return { ok: false, error: 'extensions.json must be { "extensions": [...] }' };
	const list = raw.extensions ?? [];
	if (!Array.isArray(list) || list.some((entry) => typeof entry !== "string")) {
		return { ok: false, error: '"extensions" must be a list of source strings' };
	}
	const sources = [...new Set(list.map((entry: string) => entry.trim()).filter(Boolean))];
	return { ok: true, sources, fields: raw };
}

export function writeJsonAtomic(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value, null, "\t")}\n`);
	renameSync(temporary, path);
}

export function writeDeclarations(
	path: string,
	read: Extract<DeclarationsRead, { ok: true }>,
	sources: readonly string[],
): void {
	writeJsonAtomic(path, { ...read.fields, extensions: [...sources] });
}
