import {
	existsSync,
	type FSWatcher,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	watch,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type {
	LocalLocaleFile,
	LocalLocaleFileErrorCode,
	LocalLocalesSnapshot,
} from "@thinkrail/contracts";
import { localeTagFromFileName, validateCatalog } from "@thinkrail/locales";
import { logger } from "../log";
import { dataDir } from "../persistence";

const log = logger("locales");

export const MAX_LOCALE_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_LOCALE_FILES = 64;
const DEBOUNCE_MS = 150;
const RETRY_MS = 1_000;

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

export function readLocalLocales(dir: string = localesDir()): LocalLocalesSnapshot {
	let names: string[];
	try {
		names = readdirSync(dir)
			.filter((name) => name.endsWith(".json") && !name.startsWith("."))
			.sort();
	} catch {
		names = [];
	}
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
}

export function watchLocalLocales({
	dir = localesDir(),
	onChange,
}: LocalesWatchOptions): () => void {
	let folder: FSWatcher | undefined;
	let parent: FSWatcher | undefined;
	let debounce: ReturnType<typeof setTimeout> | undefined;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	let restarted = false;
	const nudge = () => {
		clearTimeout(debounce);
		debounce = setTimeout(onChange, DEBOUNCE_MS);
	};
	const attachFolder = () => {
		folder?.close();
		folder = undefined;
		if (stopped || !existsSync(dir)) return;
		try {
			folder = watch(dir, { persistent: false }, (_event, filename) => {
				if (filename === basename(dir)) attachFolder();
				nudge();
			});
			folder.on("error", () => {
				folder?.close();
				folder = undefined;
				nudge();
			});
		} catch {
			log.warn(`could not watch locale folder ${dir}`);
		}
	};
	const restart = () => {
		parent?.close();
		parent = undefined;
		if (stopped || retry !== undefined) return;
		retry = setTimeout(() => {
			retry = undefined;
			start();
		}, RETRY_MS);
	};
	const start = () => {
		if (stopped) return;
		try {
			parent = watch(dirname(dir), { persistent: false }, (_event, filename) => {
				if (filename === basename(dirname(dir))) {
					restart();
					return;
				}
				if (filename !== null && filename !== basename(dir)) return;
				attachFolder();
				nudge();
			});
			parent.on("error", () => {
				log.warn(`locale data-folder watcher failed for ${dirname(dir)}`);
				restart();
			});
		} catch {
			log.warn(`could not watch the data folder ${dirname(dir)}`);
			restart();
		}
		attachFolder();
		if (restarted) nudge();
		restarted = true;
	};
	try {
		mkdirSync(dir, { recursive: true });
	} catch {
		log.warn(`could not create locale folder ${dir}`);
	}
	start();
	return () => {
		stopped = true;
		clearTimeout(debounce);
		clearTimeout(retry);
		folder?.close();
		parent?.close();
	};
}
