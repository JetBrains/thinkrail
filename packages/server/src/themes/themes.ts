import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
	UserThemeFile,
	UserThemeFileErrorCode,
	UserThemesSnapshot,
} from "@thinkrail/contracts";
import { logger } from "../log";
import { dataDir } from "../persistence";

const log = logger("themes");

export const MAX_THEME_FILE_BYTES = 256 * 1024;
export const MAX_THEME_FILES = 64;
const THEME_SUFFIX = ".theme.json";
const POLL_MS = 1_000;

export function themesDir(root: string = dataDir()): string {
	return join(root, "themes");
}

function failure(
	fileName: string,
	error: UserThemeFileErrorCode,
	detail?: unknown,
): UserThemeFile {
	const text = detail instanceof Error ? detail.message : detail ? String(detail) : "";
	return { fileName, ok: false, error, ...(text ? { detail: text } : {}) };
}

function readThemeFile(dir: string, fileName: string): UserThemeFile {
	const path = join(dir, fileName);
	let text: string;
	try {
		if (statSync(path).size > MAX_THEME_FILE_BYTES) return failure(fileName, "too-large");
		text = readFileSync(path, "utf8");
	} catch (error) {
		return failure(fileName, "unreadable", error);
	}
	try {
		return { fileName, ok: true, manifest: JSON.parse(text) as unknown };
	} catch (error) {
		return failure(fileName, "invalid-json", error);
	}
}

function themeFileNames(dir: string): string[] {
	try {
		return readdirSync(dir)
			.filter((name) => name.endsWith(THEME_SUFFIX) && !name.startsWith("."))
			.sort();
	} catch {
		return [];
	}
}

function folderSignature(dir: string): string {
	return themeFileNames(dir)
		.map((name) => {
			try {
				const stat = statSync(join(dir, name));
				return `${name}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
			} catch {
				return `${name}:gone`;
			}
		})
		.join("\n");
}

export function readUserThemes(dir: string = themesDir()): UserThemesSnapshot {
	const files = themeFileNames(dir).map((fileName, index) =>
		index >= MAX_THEME_FILES ? failure(fileName, "too-many") : readThemeFile(dir, fileName),
	);
	return { dir, files };
}

export interface ThemesWatchOptions {
	dir?: string;
	onChange: () => void;
	intervalMs?: number;
}

export function watchUserThemes({
	dir = themesDir(),
	onChange,
	intervalMs = POLL_MS,
}: ThemesWatchOptions): () => void {
	try {
		mkdirSync(dir, { recursive: true });
	} catch {
		log.warn(`could not create theme folder ${dir}`);
	}
	let signature = folderSignature(dir);
	const timer = setInterval(() => {
		const next = folderSignature(dir);
		if (next === signature) return;
		signature = next;
		onChange();
	}, intervalMs);
	timer.unref();
	return () => clearInterval(timer);
}
