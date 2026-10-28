import type { NativeClipboardBridge, NativeClipboardFile } from "@thinkrail/contracts";
import { type AttachedImage, fileToAttachedImage } from "./imageAttachment";

export interface PreparedPromptFile {
	name: string;
	path?: string;
	image?: AttachedImage;
	error?: "unsupported" | "pathUnavailable";
}

export function nativeClipboardBridge(): NativeClipboardBridge | undefined {
	const value: unknown = Reflect.get(globalThis, "__THINKRAIL_NATIVE_CLIPBOARD__");
	if (
		typeof value !== "object" ||
		value === null ||
		typeof Reflect.get(value, "readFiles") !== "function"
	)
		return undefined;
	return value as NativeClipboardBridge;
}

async function prepareFile(file: File, path?: string): Promise<PreparedPromptFile> {
	const result: PreparedPromptFile = { name: file.name, ...(path === undefined ? {} : { path }) };
	if (!file.type.startsWith("image/")) return { ...result, error: "pathUnavailable" };
	try {
		const image = await fileToAttachedImage(file);
		return image ? { ...result, image } : { ...result, error: "unsupported" };
	} catch {
		return { ...result, error: "unsupported" };
	}
}

async function prepareNativeFile(entry: NativeClipboardFile): Promise<PreparedPromptFile> {
	const name = entry.path.split(/[\\/]/).filter(Boolean).at(-1) ?? entry.path;
	if (!entry.image) return { name, path: entry.path };
	try {
		const bytes = Uint8Array.from(atob(entry.image.data), (character) => character.charCodeAt(0));
		return await prepareFile(new File([bytes], name, { type: entry.image.mimeType }), entry.path);
	} catch {
		return { name, path: entry.path };
	}
}

export async function preparePromptFiles(files: File[]): Promise<PreparedPromptFile[]> {
	return Promise.all(files.map((file) => prepareFile(file)));
}

export async function prepareClipboardPaste(
	files: File[],
	text: string,
	bridge?: NativeClipboardBridge,
): Promise<{ files: PreparedPromptFile[]; text: string }> {
	const nativeFiles = await bridge?.readFiles().catch((error: unknown) => {
		if (files.length === 0 && text) return [];
		throw error;
	});
	if (nativeFiles?.length) {
		return { files: await Promise.all(nativeFiles.map(prepareNativeFile)), text: "" };
	}
	return { files: await preparePromptFiles(files), text };
}

export function insertPromptText(
	value: string,
	start: number,
	end: number,
	text: string,
	paths: string[],
): { value: string; caret: number } {
	const before = value.slice(0, start);
	const after = value.slice(end);
	let insertion = text;
	if (paths.length > 0) {
		const preceding = before + insertion;
		if (preceding && !/\s$/.test(preceding)) insertion += " ";
		insertion += paths.join("\n");
		if (after && !/^\s/.test(after)) insertion += " ";
	}
	return { value: before + insertion + after, caret: before.length + insertion.length };
}
