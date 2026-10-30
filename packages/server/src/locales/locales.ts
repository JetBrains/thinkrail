import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
	LocalLocaleFile,
	LocalLocaleFileErrorCode,
	LocalLocalesSnapshot,
} from "@thinkrail/contracts";
import { localeTagFromFileName, validateCatalog } from "@thinkrail/locales";
import { logger } from "../log";
import { dataDir, listDataFolder, watchDataFolder } from "../persistence";

const log = logger("locales");

export const MAX_LOCALE_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_LOCALE_FILES = 64;

export function localesDir(root: string = dataDir()): string {
	return join(root, "locales");
}

function failure(
	fileName: string,
	tag: string | null,
	error: LocalLocaleFileErrorCode,
	detail?: string,
): LocalLocaleFile {
	return { fileName, tag, ok: false, error, ...(detail ? { detail } : {}) };
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function readLocaleFile(dir: string, fileName: string): LocalLocaleFile {
	const tag = localeTagFromFileName(fileName);
	if (!tag) return failure(fileName, null, "invalid-name");
	const path = join(dir, fileName);
	let text: string;
	try {
		if (statSync(path).size > MAX_LOCALE_FILE_BYTES) return failure(fileName, tag, "too-large");
		text = readFileSync(path, "utf8");
	} catch (error) {
		return failure(fileName, tag, "unreadable", describe(error));
	}
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		return failure(fileName, tag, "invalid-json", describe(error));
	}
	let result: ReturnType<typeof validateCatalog>;
	try {
		result = validateCatalog(raw);
	} catch (error) {
		return failure(fileName, tag, "unreadable", describe(error));
	}
	if (!result.ok) return failure(fileName, tag, result.error);
	return { fileName, tag, ok: true, strings: { ...result.strings } };
}

function localeFileNames(dir: string): string[] {
	return listDataFolder(dir, (name) => name.endsWith(".json"));
}

export function readLocalLocales(dir: string = localesDir()): LocalLocalesSnapshot {
	const names = localeFileNames(dir);
	const seen = new Set<string>();
	const files = names.map((fileName, index) => {
		if (index >= MAX_LOCALE_FILES) {
			return failure(fileName, localeTagFromFileName(fileName), "too-many");
		}
		const file = readLocaleFile(dir, fileName);
		if (file.tag === null) return file;
		const key = file.tag.toLowerCase();
		if (seen.has(key)) return failure(fileName, file.tag, "duplicate");
		seen.add(key);
		return file;
	});
	return { dir, files };
}

export interface LocalesWatchOptions {
	dir?: string;
	onChange: () => void;
	intervalMs?: number;
}

export function watchLocalLocales({
	dir = localesDir(),
	onChange,
	intervalMs,
}: LocalesWatchOptions): () => void {
	return watchDataFolder({
		dir,
		list: localeFileNames,
		onChange,
		onCreateFailed: () => log.warn(`could not create locale folder ${dir}`),
		...(intervalMs === undefined ? {} : { intervalMs }),
	});
}
