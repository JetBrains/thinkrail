import {
	CHAT_ATTACHMENT_MAX_BYTES,
	copiedFilePaths,
	type NativeClipboardBridge,
} from "@thinkrail/contracts";
import { t as translate } from "@thinkrail/locales/react";

export function withRestoredDraft(restored: string, current: string): string {
	return [restored, current].filter((part) => part.trim()).join("\n\n");
}

export function withoutSentDraft(current: string, sent: string): string {
	if (current === sent) return "";
	const suffix = `\n\n${sent}`;
	return sent.trim() !== "" && current.endsWith(suffix)
		? current.slice(0, current.length - suffix.length)
		: current;
}

export function fileAttachmentRefusal(size: number, acceptsFiles: boolean): string | null {
	if (!acceptsFiles) return translate("chat.attachments.hostTooOld");
	return size > CHAT_ATTACHMENT_MAX_BYTES ? translate("chat.attachments.tooLarge") : null;
}

const SIZE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;

export function formatFileSize(bytes: number, locale: string): string {
	let value = Math.max(0, bytes);
	let unit = 0;
	while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return new Intl.NumberFormat(locale, {
		style: "unit",
		unit: SIZE_UNITS[unit],
		unitDisplay: unit === 0 ? "narrow" : "short",
		maximumFractionDigits: unit === 0 ? 0 : 1,
	}).format(value);
}

export type ChipKeyAction =
	| { kind: "focus"; index: number }
	| { kind: "remove"; index: number; next: number | null }
	| { kind: "field" };

export function chipKeyAction(key: string, index: number, count: number): ChipKeyAction | null {
	if (count === 0) return null;
	const last = count - 1;
	switch (key) {
		case "ArrowRight":
		case "ArrowDown":
			return { kind: "focus", index: Math.min(index + 1, last) };
		case "ArrowLeft":
		case "ArrowUp":
			return { kind: "focus", index: Math.max(index - 1, 0) };
		case "Home":
			return { kind: "focus", index: 0 };
		case "End":
			return { kind: "focus", index: last };
		case "Delete":
			return { kind: "remove", index, next: last === 0 ? null : Math.min(index, last - 1) };
		case "Backspace":
			return { kind: "remove", index, next: last === 0 ? null : Math.max(index - 1, 0) };
		case "Escape":
			return { kind: "field" };
		default:
			return null;
	}
}

export function pasteMayHideFiles(types: readonly string[], text: string): boolean {
	if (
		types.some((type) => type === "Files" || type === "text/uri-list" || type.startsWith("image/"))
	)
		return true;
	return text.trim() === "" || copiedFilePaths(text) !== null;
}

export function dragMayCarryFiles(types: readonly string[]): boolean {
	return types.includes("Files") || types.includes("text/uri-list");
}

export function dropHidesFiles(
	types: readonly string[],
	fileCount: number,
	uriList: string,
): boolean {
	if (fileCount > 0) return false;
	return types.includes("Files") || (types.includes("text/uri-list") && uriList.trim() === "");
}

const NATIVE_CLIPBOARD_GLOBAL = "__THINKRAIL_NATIVE_CLIPBOARD__";

export function getNativeClipboardBridge(value: unknown): NativeClipboardBridge | null {
	if (typeof value !== "object" || value === null) return null;
	return typeof Reflect.get(value, "read") === "function" ? (value as NativeClipboardBridge) : null;
}

export function readNativeClipboardBridge(): NativeClipboardBridge | null {
	return getNativeClipboardBridge(Reflect.get(globalThis, NATIVE_CLIPBOARD_GLOBAL));
}

export function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
