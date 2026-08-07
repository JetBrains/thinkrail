// The persisted per-item baselines behind the change-set capture (SPEC §Change artifacts): what was
// already dirty (and where HEAD stood) when an item entered `in_progress`. A host-owned sidecar next to
// the todos JSON — `.thinkrail/context/todos/<sessionId>.baselines.json` — so a restart mid-item loses
// nothing (the gate and the delta compute exactly as before). Read-modify-write like the store itself;
// robust by construction: a missing/corrupt file reads as "no baselines", writes are atomic
// (temp + rename). Lives under `WORKSPACE_INTERNAL_DIR`, so it is itself filtered out of change sets.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WORKSPACE_TODOS_DIR } from "@thinkrail/shared/paths";

/** What `in_progress` snapshots: the already-dirty paths (the foreign-dirt set) + HEAD at window start. */
export interface Baseline {
	/** Worktree-relative paths already uncommitted-dirty when the item started — never the item's work. */
	paths: string[];
	/** `HEAD` when the item started (`null` = unborn). Recorded for future window-commit attribution. */
	head: string | null;
}

interface BaselineFile {
	version: 1;
	items: Record<string, Baseline>;
}

function baselinePath(root: string, sessionId: string): string {
	// The session id was validated as a safe path segment by `TodoStore` before any baseline exists.
	return join(root, WORKSPACE_TODOS_DIR, `${sessionId}.baselines.json`);
}

function isBaseline(raw: unknown): raw is Baseline {
	if (typeof raw !== "object" || raw === null) return false;
	const o = raw as Record<string, unknown>;
	return (
		Array.isArray(o.paths) &&
		o.paths.every((p) => typeof p === "string") &&
		(o.head === null || typeof o.head === "string")
	);
}

/** Read a session's baselines; a missing or corrupt file reads as none (never throws). */
export function readBaselines(root: string, sessionId: string): Record<string, Baseline> {
	try {
		const parsed: unknown = JSON.parse(readFileSync(baselinePath(root, sessionId), "utf8"));
		if (typeof parsed !== "object" || parsed === null) return {};
		const items = (parsed as Record<string, unknown>).items;
		if (typeof items !== "object" || items === null) return {};
		const out: Record<string, Baseline> = {};
		for (const [id, value] of Object.entries(items)) {
			if (isBaseline(value)) out[id] = value;
		}
		return out;
	} catch {
		return {};
	}
}

/** Write a session's baselines atomically; an empty map removes the sidecar instead of leaving `{}`. */
export function writeBaselines(
	root: string,
	sessionId: string,
	items: Record<string, Baseline>,
): void {
	const path = baselinePath(root, sessionId);
	if (Object.keys(items).length === 0) {
		rmSync(path, { force: true });
		return;
	}
	const file: BaselineFile = { version: 1, items };
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(file, null, "\t")}\n`, "utf8");
	renameSync(tmp, path);
}
