import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	type Stats,
	statSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { extname, join } from "node:path";
import {
	hasControlCharacter,
	USER_FONT_EXTENSIONS,
	USER_FONTS_ROUTE,
	type UserFontFace,
	type UserFontFile,
	type UserFontFileError,
	type UserFontFileErrorCode,
	type UserFontsSnapshot,
} from "@thinkrail/contracts";
import { logger } from "../log";
import { dataDir } from "../persistence";
import { FontFormatError, readFontFace } from "./sfnt";

const log = logger("fonts");

export const MAX_FONT_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_FONT_FILES = 128;
const COLLECTION_EXTENSIONS = new Set([".ttc", ".otc"]);
const UNPORTABLE_NAME_CHARACTERS = /[/\\<>:"|?*]/;
const POLL_MS = 1_000;

const parsedFiles = new Map<string, { version: string; entry: UserFontFile }>();

export function fontsDir(root: string = dataDir()): string {
	return join(root, "fonts");
}

type FontFileKind = "font" | "collection";

const UPLOAD_PREFIX = ".upload-";

export function fontFileKind(fileName: string): FontFileKind | null {
	if (
		fileName.startsWith(".") ||
		fileName.includes("..") ||
		UNPORTABLE_NAME_CHARACTERS.test(fileName) ||
		hasControlCharacter(fileName)
	) {
		return null;
	}
	const extension = extname(fileName).toLowerCase();
	if (USER_FONT_EXTENSIONS.some((allowed) => allowed === extension)) return "font";
	return COLLECTION_EXTENSIONS.has(extension) ? "collection" : null;
}

function failure(
	fileName: string,
	error: UserFontFileErrorCode,
	detail?: unknown,
): UserFontFileError {
	const text = detail instanceof Error ? detail.message : detail ? String(detail) : "";
	return { fileName, ok: false, error, ...(text ? { detail: text } : {}) };
}

function parseFont(fileName: string, bytes: Uint8Array): UserFontFace | UserFontFileError {
	try {
		return readFontFace(bytes);
	} catch (error) {
		return error instanceof FontFormatError && error.code === "unsupported-collection"
			? failure(fileName, error.code)
			: failure(fileName, "invalid-font", error);
	}
}

function fileVersion(stat: Stats): string {
	return createHash("sha256")
		.update(`${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`)
		.digest("base64url")
		.slice(0, 16);
}

function fontEntry(fileName: string, version: string, face: UserFontFace): UserFontFile {
	return {
		fileName,
		ok: true,
		url: `${USER_FONTS_ROUTE}${encodeURIComponent(fileName)}?v=${version}`,
		face,
	};
}

function readFontFile(dir: string, fileName: string): UserFontFile {
	if (fontFileKind(fileName) === "collection") return failure(fileName, "unsupported-collection");
	const path = join(dir, fileName);
	try {
		const stat = statSync(path);
		if (!stat.isFile()) return failure(fileName, "unreadable", "not a file");
		if (stat.size > MAX_FONT_FILE_BYTES) return failure(fileName, "too-large");
		const version = fileVersion(stat);
		const known = parsedFiles.get(path);
		if (known?.version === version) return known.entry;
		const parsed = parseFont(fileName, readFileSync(path));
		const entry = "ok" in parsed ? parsed : fontEntry(fileName, version, parsed);
		parsedFiles.set(path, { version, entry });
		return entry;
	} catch (error) {
		return failure(fileName, "unreadable", error);
	}
}

function fontFileNames(dir: string): string[] {
	try {
		return readdirSync(dir)
			.filter((name) => fontFileKind(name) !== null)
			.sort();
	} catch {
		return [];
	}
}

function folderSignature(dir: string): string {
	return fontFileNames(dir)
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

export function readUserFonts(dir: string = fontsDir()): UserFontsSnapshot {
	const names = fontFileNames(dir);
	const listed = new Set(names.map((name) => join(dir, name)));
	for (const path of parsedFiles.keys()) if (!listed.has(path)) parsedFiles.delete(path);
	const files = names.map((fileName, index) =>
		index >= MAX_FONT_FILES ? failure(fileName, "too-many") : readFontFile(dir, fileName),
	);
	return { dir, files };
}

async function writeCapped(
	path: string,
	body: ReadableStream<Uint8Array> | null,
): Promise<boolean> {
	const file = await open(path, "wx");
	try {
		let size = 0;
		for await (const chunk of body ?? []) {
			size += chunk.byteLength;
			if (size > MAX_FONT_FILE_BYTES) return false;
			await file.write(chunk);
		}
		return true;
	} finally {
		await file.close();
	}
}

export async function saveUserFont(
	fileName: string,
	body: ReadableStream<Uint8Array> | null,
	dir: string = fontsDir(),
): Promise<UserFontFile> {
	const kind = fontFileKind(fileName);
	if (kind === null) throw new Error("Not a font file name.");
	if (kind === "collection") return failure(fileName, "unsupported-collection");
	const target = join(dir, fileName);
	const temp = join(dir, `${UPLOAD_PREFIX}${randomUUID()}`);
	try {
		mkdirSync(dir, { recursive: true });
		if (!existsSync(target) && fontFileNames(dir).length >= MAX_FONT_FILES) {
			return failure(fileName, "too-many");
		}
		if (!(await writeCapped(temp, body))) return failure(fileName, "too-large");
		const parsed = parseFont(fileName, readFileSync(temp));
		if ("ok" in parsed) return parsed;
		renameSync(temp, target);
		const version = fileVersion(statSync(target));
		const entry = fontEntry(fileName, version, parsed);
		parsedFiles.set(target, { version, entry });
		return entry;
	} catch (error) {
		return failure(fileName, "unreadable", error);
	} finally {
		rmSync(temp, { force: true });
	}
}

interface FontsWatchOptions {
	dir?: string;
	onChange: () => void;
	intervalMs?: number;
}

export function watchUserFonts({
	dir = fontsDir(),
	onChange,
	intervalMs = POLL_MS,
}: FontsWatchOptions): () => void {
	try {
		mkdirSync(dir, { recursive: true });
		for (const name of readdirSync(dir)) {
			if (name.startsWith(UPLOAD_PREFIX)) rmSync(join(dir, name), { force: true });
		}
	} catch {
		log.warn(`could not prepare font folder ${dir}`);
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
