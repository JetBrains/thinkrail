import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import {
	attachmentImageType,
	copiedFilePaths,
	type NativeClipboardContent,
	type NativeClipboardFile,
} from "@thinkrail/contracts";

export interface ClipboardReader {
	availableFormats(): string[];
	readImage(): Uint8Array | null;
	readText(): string | null;
}

export interface HelperProcess {
	stdout: ReadableStream<Uint8Array>;
	exited: Promise<number>;
	kill(): void;
}

export type Spawn = (command: string[]) => HelperProcess;

export interface ClipboardLimits {
	imageBudgetBytes: number;
	listTimeoutMs: number;
	textTimeoutMs: number;
	deadlineMs: number;
}

export const CLIPBOARD_LIMITS: ClipboardLimits = {
	imageBudgetBytes: 24 * 1024 * 1024,
	listTimeoutMs: 1_000,
	textTimeoutMs: 1_500,
	deadlineMs: 4_000,
};
export const MAX_CLIPBOARD_FILES = 32;
const MAX_TEXT_BYTES = 1024 * 1024;

const FILE_TARGETS = ["text/uri-list", "x-special/gnome-copied-files"];
const TEXT_TARGETS = ["text/plain;charset=utf-8", "UTF8_STRING", "text/plain", "STRING"];
const IMAGE_TARGETS = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"];

const NONE: NativeClipboardContent = { kind: "none" };
const UNREADABLE: NativeClipboardContent = { kind: "unreadable" };

interface Helper {
	list: string[];
	read: (target: string) => string[];
}

function clipboardHelpers(env: Readonly<Record<string, string | undefined>>): Helper[] {
	const helpers: Helper[] = [];
	if (env.WAYLAND_DISPLAY) {
		helpers.push({
			list: ["wl-paste", "--list-types"],
			read: (target) => ["wl-paste", "--no-newline", "--type", target],
		});
	}
	if (env.DISPLAY) {
		helpers.push({
			list: ["xclip", "-o", "-selection", "clipboard", "-t", "TARGETS"],
			read: (target) => ["xclip", "-o", "-selection", "clipboard", "-t", target],
		});
	}
	return helpers;
}

const spawnHelper: Spawn = (command) => {
	const child = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
	return { stdout: child.stdout, exited: child.exited, kill: () => child.kill("SIGKILL") };
};

type HelperRun =
	| { kind: "ok"; bytes: Buffer }
	| { kind: "missing" | "failed" | "timeout" | "too-large" };

async function runHelper(
	spawn: Spawn,
	command: string[],
	timeoutMs: number,
	maxBytes: number,
): Promise<HelperRun> {
	if (timeoutMs <= 0) return { kind: "timeout" };
	let child: HelperProcess;
	try {
		child = spawn(command);
	} catch {
		return { kind: "missing" };
	}
	const reader = child.stdout.getReader();
	let stopped: "timeout" | "too-large" | null = null;
	const stop = (reason: "timeout" | "too-large") => {
		stopped ??= reason;
		child.kill();
		reader.cancel().catch(() => undefined);
	};
	const timer = setTimeout(() => stop("timeout"), timeoutMs);
	try {
		const chunks: Uint8Array[] = [];
		let size = 0;
		for (let next = await reader.read(); !next.done; next = await reader.read()) {
			size += next.value.byteLength;
			if (size > maxBytes) {
				stop("too-large");
				break;
			}
			chunks.push(next.value);
		}
		const code = stopped ? null : await child.exited;
		if (stopped) return { kind: stopped };
		return code === 0 ? { kind: "ok", bytes: Buffer.concat(chunks) } : { kind: "failed" };
	} catch {
		return { kind: stopped ?? "failed" };
	} finally {
		clearTimeout(timer);
	}
}

async function describeFiles(
	paths: readonly string[],
	budgetBytes: number,
): Promise<NativeClipboardFile[]> {
	const files: NativeClipboardFile[] = [];
	let left = budgetBytes;
	for (const path of paths.slice(0, MAX_CLIPBOARD_FILES)) {
		const stats = await stat(path).catch(() => null);
		if (!stats?.isFile()) continue;
		const file: NativeClipboardFile = { path, name: basename(path), size: stats.size };
		const mimeType = attachmentImageType({ name: file.name, type: "" });
		const bytes =
			mimeType !== null && stats.size <= left ? await readFile(path).catch(() => null) : null;
		if (mimeType !== null && bytes !== null && bytes.byteLength <= left) {
			left -= bytes.byteLength;
			files.push({ ...file, image: { mimeType, data: bytes.toString("base64") } });
		} else {
			files.push(file);
		}
	}
	return files;
}

async function readWithHelper(
	spawn: Spawn,
	helper: Helper,
	limits: ClipboardLimits,
	deadline: number,
): Promise<NativeClipboardContent | null> {
	const left = () => deadline - Date.now();
	const listed = await runHelper(
		spawn,
		helper.list,
		Math.min(limits.listTimeoutMs, left()),
		MAX_TEXT_BYTES,
	);
	if (listed.kind === "timeout") return UNREADABLE;
	if (listed.kind !== "ok") return null;
	const offered = new Set(
		listed.bytes
			.toString("utf8")
			.split(/\r?\n/)
			.map((target) => target.trim()),
	);
	const fileTargets = FILE_TARGETS.filter((target) => offered.has(target));
	const textTarget = TEXT_TARGETS.find((target) => offered.has(target));
	const barePaths = fileTargets.length > 0;
	for (const target of textTarget ? [...fileTargets, textTarget] : fileTargets) {
		const listedFiles = await runHelper(
			spawn,
			helper.read(target),
			Math.min(limits.textTimeoutMs, left()),
			MAX_TEXT_BYTES,
		);
		if (listedFiles.kind === "timeout") return UNREADABLE;
		if (listedFiles.kind !== "ok") continue;
		const paths = copiedFilePaths(listedFiles.bytes.toString("utf8"), { barePaths });
		const files = paths === null ? [] : await describeFiles(paths, limits.imageBudgetBytes);
		if (files.length > 0) return { kind: "files", files };
	}
	const imageTarget = IMAGE_TARGETS.find((target) => offered.has(target));
	if (imageTarget !== undefined) {
		const image = await runHelper(spawn, helper.read(imageTarget), left(), limits.imageBudgetBytes);
		if (image.kind === "too-large") return { kind: "oversized" };
		if (image.kind === "ok" && image.bytes.byteLength > 0) {
			return { kind: "image", mimeType: imageTarget, data: image.bytes.toString("base64") };
		}
		return UNREADABLE;
	}
	return fileTargets.length > 0 ? UNREADABLE : NONE;
}

async function readWithElectrobun(
	reader: ClipboardReader,
	budgetBytes: number,
): Promise<NativeClipboardContent> {
	const formats = reader.availableFormats();
	const barePaths = formats.includes("files");
	if (barePaths || formats.includes("text")) {
		const paths = copiedFilePaths(reader.readText() ?? "", { barePaths });
		const files = paths === null ? [] : await describeFiles(paths, budgetBytes);
		if (files.length > 0) return { kind: "files", files };
	}
	if (formats.includes("image")) {
		const png = reader.readImage();
		if (png !== null && png.byteLength > budgetBytes) return { kind: "oversized" };
		if (png !== null && png.byteLength > 0) {
			return { kind: "image", mimeType: "image/png", data: Buffer.from(png).toString("base64") };
		}
	}
	return formats.includes("files") ? UNREADABLE : NONE;
}

export async function readNativeClipboard(
	fallback: ClipboardReader,
	{
		env = process.env,
		spawn = spawnHelper,
		limits = CLIPBOARD_LIMITS,
	}: {
		env?: Readonly<Record<string, string | undefined>>;
		spawn?: Spawn;
		limits?: ClipboardLimits;
	} = {},
): Promise<NativeClipboardContent> {
	const deadline = Date.now() + limits.deadlineMs;
	for (const helper of clipboardHelpers(env)) {
		const content = await readWithHelper(spawn, helper, limits, deadline);
		if (content !== null) return content;
	}
	return readWithElectrobun(fallback, limits.imageBudgetBytes);
}
