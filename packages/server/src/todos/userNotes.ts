import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WORKSPACE_TODOS_DIR } from "@thinkrail/shared/paths";

const USER_NOTES_SUFFIX = ".userNotes.json";

interface UserNotesFile {
	version: 1;
	/** Map of todo item id → array of user notes (oldest first). */
	items: Record<string, string[]>;
}

function userNotesPath(root: string, sessionId: string): string {
	return join(root, WORKSPACE_TODOS_DIR, `${sessionId}${USER_NOTES_SUFFIX}`);
}

function readFile(root: string, sessionId: string): UserNotesFile {
	try {
		const parsed: unknown = JSON.parse(readFileSync(userNotesPath(root, sessionId), "utf8"));
		if (typeof parsed !== "object" || parsed === null) return { version: 1, items: {} };
		const o = parsed as Record<string, unknown>;
		const items: Record<string, string[]> = {};
		if (typeof o.items === "object" && o.items !== null) {
			for (const [id, value] of Object.entries(o.items)) {
				if (Array.isArray(value) && value.every((s) => typeof s === "string")) {
					items[id] = value;
				}
			}
		}
		return { version: 1, items };
	} catch {
		return { version: 1, items: {} };
	}
}

function writeFile(root: string, sessionId: string, file: UserNotesFile): void {
	const path = userNotesPath(root, sessionId);
	const empty = Object.keys(file.items).length === 0;
	if (empty) {
		rmSync(path, { force: true });
		return;
	}
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(file, null, "\t")}\n`, "utf8");
	renameSync(tmp, path);
}

/** Read all user notes for a session. */
export function readUserNotes(root: string, sessionId: string): Record<string, string[]> {
	return readFile(root, sessionId).items;
}

/** Append a user note to an item. */
export function addUserNote(root: string, sessionId: string, itemId: string, note: string): void {
	const file = readFile(root, sessionId);
	const existing = file.items[itemId] ?? [];
	file.items[itemId] = [...existing, note];
	writeFile(root, sessionId, file);
}

/** Remove all user notes for an item (called when the item is removed). */
export function dropItemUserNotes(root: string, sessionId: string, itemId: string): void {
	const file = readFile(root, sessionId);
	if (!file.items[itemId]) return;
	delete file.items[itemId];
	writeFile(root, sessionId, file);
}

/** Remove all user notes for a session (called when the session is deleted). */
export function removeSessionUserNotes(root: string, sessionId: string): void {
	try {
		rmSync(userNotesPath(root, sessionId), { force: true });
	} catch {}
}
