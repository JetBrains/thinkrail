import { isAbsolute, win32 } from "node:path";
import type { NativeOpenFileRequest } from "@thinkrail/contracts";

const MAX_URL_LENGTH = 8 * 1024;
const MAX_PATH_LENGTH = 4_096;
const MAX_POSITION = 2_000_000;

function positiveInteger(value: string | null): number | null {
	if (value === null) return null;
	if (!/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_POSITION ? parsed : null;
}

/**
 * Reads the one URL shape LocatorJS (or any external tool) can hand to the desktop app:
 * `thinkrail://open?file=/absolute/path.tsx&line=12&column=3`.
 *
 * `line` defaults to 1; a present but malformed `line`/`column` rejects the whole link rather
 * than silently opening the wrong place. The file must be absolute so a web page cannot turn
 * the scheme into a relative-path lookup.
 */
export function parseThinkRailDeepLink(raw: string): NativeOpenFileRequest | null {
	if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL_LENGTH) return null;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== "thinkrail:" || url.hostname !== "open") return null;
	const file = url.searchParams.get("file");
	if (file === null || file.length === 0 || file.length > MAX_PATH_LENGTH) return null;
	if (file.includes("\0") || !(isAbsolute(file) || win32.isAbsolute(file))) return null;
	const rawLine = url.searchParams.get("line");
	const line = rawLine === null ? 1 : positiveInteger(rawLine);
	if (line === null) return null;
	const rawColumn = url.searchParams.get("column");
	const column = rawColumn === null ? null : positiveInteger(rawColumn);
	if (rawColumn !== null && column === null) return null;
	return { file, line, ...(column === null ? {} : { column }) };
}
