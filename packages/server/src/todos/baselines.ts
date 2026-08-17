// The persisted per-item baselines behind the change-set capture (SPEC §Change artifacts): what was
// already dirty (and where HEAD stood) when an item entered `in_progress`. A host-owned sidecar next to
// the todos JSON — `.thinkrail/context/todos/<sessionId>.baselines.json` — so a restart mid-item loses
// nothing (the gate and the delta compute exactly as before). Read-modify-write like the store itself;
// robust by construction: a missing/corrupt file reads as "no baselines", writes are atomic
// (temp + rename). Lives under `WORKSPACE_INTERNAL_DIR`, so it is itself filtered out of change sets.

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WORKSPACE_TODOS_DIR } from "@thinkrail/shared/paths";

/** The sidecar's filename suffix — also how a workspace's sidecars are enumerated (see {@link otherOpenWindows}). */
const BASELINE_SUFFIX = ".baselines.json";

/** What `in_progress` snapshots: the already-dirty paths (the foreign-dirt set) + HEAD at window start. */
export interface Baseline {
	/** Worktree-relative paths already uncommitted-dirty when the item started — never the item's work. */
	paths: string[];
	/** `HEAD` when the item started (`null` = unborn). Recorded for future window-commit attribution. */
	head: string | null;
	/**
	 * Set once this window has **ever overlapped another** — another item of this plan, or another chat in the
	 * same worktree (marked at both ends: on this window's open, and retroactively when a later window opens
	 * beside it). A shared window's post-baseline dirt can't be attributed to one item, so it may never be
	 * committed — only reported as a path list. Sticky by design: "was exclusive for its whole life" is the
	 * property the commit gate needs, and that can't be re-derived once the other window has closed.
	 */
	shared?: boolean;
}

interface BaselineFile {
	version: 1;
	items: Record<string, Baseline>;
}

function baselinePath(root: string, sessionId: string): string {
	// The session id was validated as a safe path segment by `TodoStore` before any baseline exists.
	return join(root, WORKSPACE_TODOS_DIR, `${sessionId}${BASELINE_SUFFIX}`);
}

function isBaseline(raw: unknown): raw is Baseline {
	if (typeof raw !== "object" || raw === null) return false;
	const o = raw as Record<string, unknown>;
	return (
		Array.isArray(o.paths) &&
		o.paths.every((p) => typeof p === "string") &&
		(o.head === null || typeof o.head === "string") &&
		(o.shared === undefined || typeof o.shared === "boolean")
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

/**
 * Whether **another chat** has a work window open in this worktree (any baseline recorded by a session
 * other than `sessionId`). Half of the exclusivity signal behind the commit gate (SPEC §Change artifacts):
 * one worktree is shared by every chat in the workspace, so a second chat mid-item means the post-baseline
 * dirt can't be attributed to one item and the commit must be skipped in favour of the path-list fallback.
 * (The *same* chat's concurrent items are read off the plan instead — statuses there are current, while a
 * sibling sidecar is the only window into another session.) Enumerates the sidecars because each session
 * owns its own file; a missing dir (no window ever opened) or an unreadable entry reads as "none open" —
 * never throws.
 */
export function otherSessionWindows(root: string, sessionId: string): boolean {
	return otherOwners(root, sessionId).some(
		(owner) => Object.keys(readBaselines(root, owner)).length > 0,
	);
}

/**
 * Retroactively mark **other chats'** open windows as shared (see {@link Baseline.shared}) — called when a
 * window opens beside them, since the window that opened *first* recorded itself as exclusive and would
 * otherwise still believe it. Best-effort like the rest of the sidecar: an unreadable/unwritable sibling is
 * skipped. Safe to write another session's file: every reconcile for a workspace runs on one serialized
 * queue, so there is no concurrent writer.
 */
export function markOtherSessionWindowsShared(root: string, sessionId: string): void {
	for (const owner of otherOwners(root, sessionId)) {
		const items = readBaselines(root, owner);
		const open = Object.values(items);
		if (open.length === 0 || open.every((b) => b.shared)) continue;
		for (const baseline of open) baseline.shared = true;
		try {
			writeBaselines(root, owner, items);
		} catch {
			// a sibling we can't rewrite just keeps its stale flag — the gate errs toward the fallback anyway
		}
	}
}

/** The other sessions owning a sidecar in this worktree (a missing dir reads as none — never throws). */
function otherOwners(root: string, sessionId: string): string[] {
	try {
		return readdirSync(join(root, WORKSPACE_TODOS_DIR))
			.filter((n) => n.endsWith(BASELINE_SUFFIX))
			.map((n) => n.slice(0, -BASELINE_SUFFIX.length))
			.filter((owner) => owner !== sessionId);
	} catch {
		return [];
	}
}

/**
 * Drop one item's baseline (if any) — called when a plan mutation removes the item outside a reconcile
 * (the UI's `todo.remove`), so the deleted item's work window closes with it. Read-modify-write like the
 * store; a missing sidecar or absent id is a no-op.
 */
export function dropItemBaseline(root: string, sessionId: string, id: string): void {
	const items = readBaselines(root, sessionId);
	if (items[id] === undefined) return;
	delete items[id];
	writeBaselines(root, sessionId, items);
}

/**
 * Remove a session's whole sidecar — called when the chat itself is deleted, so its open windows die with
 * it instead of haunting every later overlap check as a permanently "open" foreign window (which would
 * force sibling chats into the path-list fallback forever). Best-effort, idempotent, never throws.
 */
export function removeSessionBaselines(root: string, sessionId: string): void {
	try {
		rmSync(baselinePath(root, sessionId), { force: true });
	} catch {
		// an unremovable sidecar keeps erring toward the fallback — never fail the caller's delete
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
