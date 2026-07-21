// The per-session TODO store: read-modify-write a single JSON file (`.thinkrail/context/todos/<sessionId>.json`)
// under a worktree root. The file is the source of truth — every op re-reads it, so external edits and
// other sessions are always seen; there is no cache to stale (the list is tiny). Pi-free (node built-ins
// only) so the host can value-import it to read *and write* the plan (the user's UI edits), the way
// `server/src/spec` value-imports `pi-spec-graph/core`.
//
// The plan is loose items (standalone + user) + named groups (each with its own items). Robust by
// construction: a missing or corrupt file reads as an empty plan rather than throwing, and
// unknown/invalid fields are dropped on read — the store never lets a hand-edited file crash a session.
// Writes are atomic (tmp file + rename) so a crash or a concurrent reader never sees a torn file.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	TODO_ARTIFACT_KINDS,
	TODO_ORIGINS,
	TODO_STATUSES,
	type Todo,
	type TodoArtifact,
	type TodoFile,
	type TodoGroup,
	type TodoInput,
	type TodoOrigin,
	type TodoPatch,
	type TodoPlan,
	type TodoStatus,
	type WritePlan,
} from "./types.ts";

// ThinkRail's ephemeral per-worktree scratch dir. Mirrors `@thinkrail/shared`'s `WORKSPACE_CONTEXT_DIR`,
// duplicated (not imported) on purpose: `core/` stays free of any `@thinkrail/*` dep so `pi-todos` remains
// installable under vanilla `pi`. The host is the source of truth — keep this value in step with shared.
const CONTEXT_DIR = ".thinkrail/context";

/** Directory (under a worktree root) holding one file per chat session's TODO list. */
export const STORE_DIR = `${CONTEXT_DIR}/todos`;

/**
 * A session id becomes a single path segment (`<sessionId>.json`), so it must not contain path
 * separators or `..` — otherwise a crafted id could escape the store dir and read/write an arbitrary
 * file. Session ids are UUID-shaped tab ids; reject anything outside that safe charset.
 */
function assertSafeSessionId(sessionId: string): void {
	if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
		throw new Error(`Invalid session id for TODO store: ${JSON.stringify(sessionId)}`);
	}
}

/** The store file for a session, relative to a worktree root. */
export function storeRel(sessionId: string): string {
	assertSafeSessionId(sessionId);
	return `${STORE_DIR}/${sessionId}.json`;
}

/** Total item count across loose items + every group. */
export function countItems(plan: TodoPlan): number {
	return plan.todos.length + plan.groups.reduce((n, g) => n + g.todos.length, 0);
}

const CURRENT_VERSION = 3 as const;

const STATUS_SET: ReadonlySet<string> = new Set(TODO_STATUSES);
const ORIGIN_SET: ReadonlySet<string> = new Set(TODO_ORIGINS);
const ARTIFACT_KIND_SET: ReadonlySet<string> = new Set(TODO_ARTIFACT_KINDS);

function isStatus(v: unknown): v is TodoStatus {
	return typeof v === "string" && STATUS_SET.has(v);
}
function isOrigin(v: unknown): v is TodoOrigin {
	return typeof v === "string" && ORIGIN_SET.has(v);
}

function nowIso(): string {
	return new Date().toISOString();
}
function freshId(prefix: string): string {
	// 12 hex chars (48 bits) — ids are resolved by first match, so keep enough entropy to avoid collisions.
	return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/**
 * Decode literal `\uXXXX` escape sequences that a model sometimes emits *as text*: when it double-escapes
 * the backslash, a tool-call arg arrives as the literal 6-char string "Б" instead of the character
 * it denotes, so the plan renders escape gibberish instead of (e.g.) Cyrillic. Fold well-formed sequences
 * back to real characters; a normal string (no `\u`) is untouched.
 *
 * Applied **only to agent-authored text** (via {@link decodeIfAgent}) — never the user's own UI input,
 * which is stored verbatim so that a literal `A` the human types stays `A`, not `A`.
 */
function decodeEscapes(s: string): string {
	return s.includes("\\u")
		? s.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
		: s;
}

/** Decode escapes for agent-authored strings only; user input is returned untouched. */
function decodeIfAgent(s: string, origin: TodoOrigin): string {
	return origin === "agent" ? decodeEscapes(s) : s;
}

/**
 * Coerce a parsed value into a list of valid artifacts, dropping malformed entries; returns `undefined`
 * (not `[]`) when there are none, so an item without artifacts serializes without the key. `label` is
 * decoded for agent-authored items (like `title`/`note`); `path`/`specId` are stored verbatim.
 */
function sanitizeArtifacts(raw: unknown, origin: TodoOrigin): TodoArtifact[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const out: TodoArtifact[] = [];
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null) continue;
		const o = entry as Record<string, unknown>;
		if (typeof o.kind !== "string" || !ARTIFACT_KIND_SET.has(o.kind)) continue;
		if (typeof o.path !== "string" || !o.path) continue;
		const artifact: TodoArtifact = { kind: o.kind as TodoArtifact["kind"], path: o.path };
		if (typeof o.label === "string" && o.label) artifact.label = decodeIfAgent(o.label, origin);
		if (typeof o.specId === "string" && o.specId) artifact.specId = o.specId;
		out.push(artifact);
	}
	return out.length > 0 ? out : undefined;
}

/** Coerce an arbitrary parsed value into a valid Todo, or drop it (return null) when unusable. */
function sanitize(raw: unknown): Todo | null {
	if (typeof raw !== "object" || raw === null) return null;
	const o = raw as Record<string, unknown>;
	if (typeof o.id !== "string" || typeof o.title !== "string") return null;
	const now = nowIso();
	const origin: TodoOrigin = isOrigin(o.origin) ? o.origin : "agent";
	const todo: Todo = {
		id: o.id,
		title: decodeIfAgent(o.title, origin),
		status: isStatus(o.status) ? o.status : "pending",
		origin,
		createdAt: typeof o.createdAt === "string" ? o.createdAt : now,
		updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : now,
	};
	if (typeof o.note === "string" && o.note) todo.note = decodeIfAgent(o.note, origin);
	const artifacts = sanitizeArtifacts(o.artifacts, origin);
	if (artifacts) todo.artifacts = artifacts;
	return todo;
}

/** Coerce a parsed value into a valid group, dropping invalid items; drop the group if it has none. */
function sanitizeGroup(raw: unknown): TodoGroup | null {
	if (typeof raw !== "object" || raw === null) return null;
	const o = raw as Record<string, unknown>;
	if (typeof o.title !== "string") return null;
	const todos = Array.isArray(o.todos)
		? o.todos.map(sanitize).filter((t): t is Todo => t !== null)
		: [];
	if (todos.length === 0) return null;
	return {
		id: typeof o.id === "string" ? o.id : freshId("g"),
		title: decodeEscapes(o.title),
		todos,
	};
}

function makeTodo(
	title: string,
	status: TodoStatus,
	origin: TodoOrigin,
	note?: string,
	artifacts?: TodoArtifact[],
): Todo {
	const now = nowIso();
	const todo: Todo = {
		id: freshId("t"),
		title: decodeIfAgent(title, origin),
		status,
		origin,
		createdAt: now,
		updatedAt: now,
	};
	if (note) todo.note = decodeIfAgent(note, origin);
	const clean = sanitizeArtifacts(artifacts, origin);
	if (clean) todo.artifacts = clean;
	return todo;
}

/**
 * A single chat session's TODO plan, stored as one JSON file under the worktree
 * (`.thinkrail/context/todos/<sessionId>.json`). One instance per (root, session); every method re-reads the
 * file, so the instance holds no mutable state and stale reads are impossible — the agent's writes and
 * the user's UI writes converge on the same file.
 */
export class TodoStore {
	/** Absolute path to the store file. */
	readonly file: string;

	constructor(root: string, sessionId: string) {
		this.file = join(root, storeRel(sessionId));
	}

	/** The whole plan as stored (loose items + groups), tolerating a missing/corrupt file (→ empty). */
	read(): TodoPlan {
		if (!existsSync(this.file)) return { todos: [], groups: [] };
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(this.file, "utf8"));
		} catch {
			return { todos: [], groups: [] };
		}
		const file = parsed as Partial<TodoFile> | null;
		const todos = Array.isArray(file?.todos)
			? file.todos.map(sanitize).filter((t): t is Todo => t !== null)
			: [];
		const groups = Array.isArray(file?.groups)
			? file.groups.map(sanitizeGroup).filter((g): g is TodoGroup => g !== null)
			: [];
		return { todos, groups };
	}

	/** Every item across loose + groups, in display order. */
	flat(): Todo[] {
		const plan = this.read();
		return [...plan.todos, ...plan.groups.flatMap((g) => g.todos)];
	}

	/** Items, optionally filtered by status (flattened across loose + groups). */
	list(status?: TodoStatus): Todo[] {
		const all = this.flat();
		return status ? all.filter((t) => t.status === status) : all;
	}

	/** One item by id (searching loose + groups), or undefined. */
	get(id: string): Todo | undefined {
		return this.flat().find((t) => t.id === id);
	}

	/**
	 * Add one item; returns the created Todo. `input.group` (a title) places it in that named group —
	 * created if new — otherwise it's appended loose.
	 */
	add(input: TodoInput): Todo {
		const todo = makeTodo(
			input.title,
			"pending",
			input.origin ?? "agent",
			input.note,
			input.artifacts,
		);
		const plan = this.read();
		const groupTitle = input.group ? decodeEscapes(input.group) : undefined;
		if (groupTitle) {
			let group = plan.groups.find((g) => g.title === groupTitle);
			if (!group) {
				group = { id: freshId("g"), title: groupTitle, todos: [] };
				plan.groups.push(group);
			}
			group.todos.push(todo);
		} else {
			plan.todos.push(todo);
		}
		this.write(plan);
		return todo;
	}

	/** Apply a partial change to an item; returns the updated Todo, or undefined if the id is unknown. */
	update(id: string, patch: TodoPatch): Todo | undefined {
		const plan = this.read();
		const todo = [...plan.todos, ...plan.groups.flatMap((g) => g.todos)].find((t) => t.id === id);
		if (!todo) return undefined;
		if (patch.title !== undefined) todo.title = decodeIfAgent(patch.title, todo.origin);
		if (patch.status !== undefined) todo.status = patch.status;
		if (patch.note !== undefined) {
			if (patch.note) todo.note = decodeIfAgent(patch.note, todo.origin);
			else delete todo.note;
		}
		if (patch.artifacts !== undefined) {
			const clean = sanitizeArtifacts(patch.artifacts, todo.origin);
			if (clean) todo.artifacts = clean;
			else delete todo.artifacts;
		}
		todo.updatedAt = nowIso();
		this.write(plan);
		return todo;
	}

	/** Remove an item (loose or grouped); returns whether it existed. Empties out a group left blank. */
	remove(id: string): boolean {
		const plan = this.read();
		const before = countItems(plan);
		plan.todos = plan.todos.filter((t) => t.id !== id);
		for (const group of plan.groups) group.todos = group.todos.filter((t) => t.id !== id);
		if (countItems(plan) === before) return false;
		this.write(plan);
		return true;
	}

	/**
	 * Re-lay the agent's plan (`todo_write`): replace the agent's own open items with `plan` (fresh
	 * `agent` items — loose + groups), but **preserve the user's items and any done item** — so
	 * re-planning never drops the user's requests or the completed history. Preserved user items stay
	 * loose; a preserved done item rejoins its group if the new plan still has one by that title, else it
	 * falls back to loose. Kept items come after the fresh plan.
	 */
	replaceAll(plan: WritePlan): TodoPlan {
		const freshLoose = (plan.todos ?? []).map((w) =>
			makeTodo(w.title, w.status ?? "pending", "agent", w.note, w.artifacts),
		);
		const freshGroups: TodoGroup[] = (plan.groups ?? []).map((g) => ({
			id: freshId("g"),
			title: decodeEscapes(g.title),
			todos: g.todos.map((w) =>
				makeTodo(w.title, w.status ?? "pending", "agent", w.note, w.artifacts),
			),
		}));

		const current = this.read();
		const keptLoose = current.todos.filter((t) => t.origin === "user" || t.status === "done");
		const resultLoose = [...freshLoose, ...keptLoose];
		// Grouped survivors: user items rejoin loose (never grouped); done items rejoin their group by
		// title if it still exists, else fall back to loose so history is never lost.
		for (const old of current.groups) {
			for (const t of old.todos) {
				if (t.origin === "user") {
					resultLoose.push(t);
				} else if (t.status === "done") {
					const match = freshGroups.find((g) => g.title === old.title);
					if (match) match.todos.push(t);
					else resultLoose.push(t);
				}
			}
		}

		const next: TodoPlan = { todos: resultLoose, groups: freshGroups };
		this.write(next);
		return next;
	}

	/**
	 * Serialize the plan back to disk (dropping empty groups; creating `.thinkrail/context/todos/` if needed).
	 * Atomic: write a sibling temp file then `rename` it over the target, so a crash or a concurrent
	 * reader (this package is portable to vanilla pi, where a second process is real) never observes a
	 * half-written file — and `read()`'s torn-file fallback (→ empty plan) can't silently drop the list.
	 */
	private write(plan: TodoPlan): void {
		const file: TodoFile = {
			version: CURRENT_VERSION,
			todos: plan.todos,
			groups: plan.groups.filter((g) => g.todos.length > 0),
		};
		mkdirSync(dirname(this.file), { recursive: true });
		const tmp = `${this.file}.${randomUUID().slice(0, 8)}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
		renameSync(tmp, this.file);
	}
}
