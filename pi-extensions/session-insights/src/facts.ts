import { createHash } from "node:crypto";
import {
	type PlanStatus,
	TODO_TEXT_GROUP,
	TODO_TEXT_ITEM,
	TODO_TOOLS,
	type TodoRecord,
} from "./core.ts";
import { resolvePath, slashed, type WorkspacePaths, workspacePaths } from "./paths.ts";
import { maskSecretFields, type Redactor, safeCut } from "./redact.ts";
import { shellWrites } from "./toolFamily.ts";
import { isRecord } from "./totals.ts";

const WORD_LIMIT = 256;
const TITLE_CHARS = 200;
const NOTE_CHARS = 600;
const LINE_CHARS = 240;
const KEY_CHARS = 180;
const SKILL_FILE = /(^|\/)SKILL\.md$/;
const SKILL_FILE_ANY_CASE = new RegExp(SKILL_FILE.source, "i");
const PROMPT_SKILL = /^<skill name="([^"]+)"|^\/skill:([A-Za-z0-9._-]+)/;
const EDIT_TOOLS: readonly string[] = ["edit", "write"];
const FILE_TOOLS: readonly string[] = ["read", "edit", "write"];
const SHELL_TOOLS: readonly string[] = ["bash", "background_command"];
const PATH_CHARS = 400;
export interface TodoArgs {
	id: string | null;
	group: string | null;
	summary: string | null;
	/** A `todo_list` filtered by status: items it leaves out were not removed. */
	filtered: boolean;
}

/** A `read`/`edit`/`write` call's file: relative to the session's folder when inside it, else redacted. */
export interface FileRef {
	path: string;
	inside: boolean;
	/** A `write`: the lines of its content. */
	lines: number | null;
}

export interface CallFacts {
	key: string;
	path: string | null;
	words: readonly number[];
	/** Hashed objects of the arguments (file names, line ranges, identifiers), for the two-session alignment. */
	objects: readonly number[];
	skill: string | null;
	todo: TodoArgs | null;
	edit: boolean;
	/** A shell command that writes into a file (`shellWrites`). */
	writes: boolean;
	file: FileRef | null;
}

/** Lines an `edit` result's patch added and removed, and the first changed line it reports. */
export interface EditLines {
	added: number;
	removed: number;
	line: number | null;
}

export interface TodoItem {
	id: string;
	title: string | null;
	status: PlanStatus | null;
	origin: "agent" | "user" | null;
	groupId: string | null;
	group: string | null;
}

export interface TodoResult {
	/** `plan`: the whole plan or a filtered list; `item`: one todo; `group`: a promoted item. */
	kind: "plan" | "item" | "group" | "none";
	items: readonly TodoItem[];
	groups: readonly { id: string; title: string }[];
	/** Todos `todo_update` returned to pending when another went in progress. */
	paused: readonly string[];
}

export interface ResultFacts {
	errorKey: string | null;
	errorLine: string | null;
	todo: TodoResult | null;
	edit: EditLines | null;
}

function text(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function normalized(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalized);
	if (isRecord(value)) {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort())
			Object.defineProperty(out, key, {
				value: normalized(value[key]),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		return out;
	}
	return typeof value === "string" ? value.trim() : value;
}

export function digest(value: string): string {
	return createHash("sha1").update(value).digest("base64").slice(0, 16);
}

/** Stable identity of a call: its tool and its arguments with sorted keys and trimmed strings. */
export function callKey(name: string, args: unknown): string {
	let serialized: string;
	try {
		serialized = JSON.stringify(normalized(args ?? {})) ?? "";
	} catch {
		serialized = "";
	}
	return digest(`${name}\u0000${serialized}`);
}

function fnv(word: string): number {
	let hash = 0x811c9dc5;
	for (let at = 0; at < word.length; at++) {
		hash ^= word.charCodeAt(at);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** The argument a retry changes: `command`, `query`, `pattern` or `url`, else the arguments as JSON with secret-named values masked. */
export function mainArgument(args: unknown): string {
	if (isRecord(args))
		for (const key of ["command", "query", "pattern", "url"] as const) {
			const value = args[key];
			if (typeof value === "string") return value;
		}
	try {
		return JSON.stringify(maskSecretFields(args ?? {})) ?? "";
	} catch {
		return "";
	}
}

const OBJECT =
	/[\w.-]+\.(?:d\.ts|tsx|ts|jsx|js|mjs|cjs|md|json|jsonl|ya?ml|toml|css|html|py|rs|go|sh|sql|txt)\b|\b\d+,\d+p\b|\b[a-z]+[A-Z][A-Za-z0-9]+\b|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g;
const OBJECT_LIMIT = 32;

/** What a call works on: file names (without folders), `sed` ranges, camelCase and CONST_CASE names. */
export function objectsOf(value: string): number[] {
	const set = new Set<number>();
	for (const match of value.match(OBJECT) ?? []) {
		set.add(fnv(match.toLowerCase().replace(/^.*\//, "")));
		if (set.size >= OBJECT_LIMIT) break;
	}
	return [...set].sort((a, b) => a - b);
}

function wordsOf(value: string): string[] {
	return value.toLowerCase().match(/[\w./~-]+/g) ?? [];
}

function wordHashes(value: string): number[] {
	const set = new Set<number>();
	for (const word of wordsOf(value)) {
		set.add(fnv(word));
		if (set.size >= WORD_LIMIT) break;
	}
	return [...set].sort((a, b) => a - b);
}

/** Jaccard overlap of two sorted, unique hash lists. */
export function sharedWords(a: readonly number[], b: readonly number[]): number {
	if (a.length === 0 || b.length === 0) return 0;
	let i = 0;
	let j = 0;
	let common = 0;
	while (i < a.length && j < b.length) {
		const left = a[i] ?? 0;
		const right = b[j] ?? 0;
		if (left === right) {
			common += 1;
			i += 1;
			j += 1;
		} else if (left < right) i += 1;
		else j += 1;
	}
	return common / (a.length + b.length - common);
}

function skillOf(
	name: string,
	args: Record<string, unknown>,
	redactor: Redactor,
	paths: WorkspacePaths,
): string | null {
	if (name !== "read") return null;
	const raw = text(args.path) ?? text(args.file_path);
	const path = raw === null ? null : slashed(raw, paths);
	if (!path || !(paths.windows ? SKILL_FILE_ANY_CASE : SKILL_FILE).test(path)) return null;
	const parts = path.split("/").filter(Boolean);
	const folder = parts.at(-2);
	return folder ? redactor.label(folder, 80) : null;
}

function lineCount(value: string): number {
	if (!value) return 0;
	let lines = 1;
	for (let at = value.indexOf("\n"); at !== -1; at = value.indexOf("\n", at + 1)) lines += 1;
	return value.endsWith("\n") ? lines - 1 : lines;
}

/**
 * A file path as the matrix keys it: relative to the session's folder (`/` separators, in the folder's
 * own path flavor) when inside it, else redacted.
 */
export function fileKey(raw: string, paths: WorkspacePaths, redactor: Redactor): FileRef | null {
	const trimmed = raw.trim().replace(/^@/, "");
	if (!trimmed) return null;
	const { relative, written } = resolvePath(trimmed, paths);
	if (relative) return { path: redactor.label(relative, PATH_CHARS), inside: true, lines: null };
	return { path: redactor.label(written, PATH_CHARS), inside: false, lines: null };
}

/** Added and removed lines of an `edit` result: its unified `patch`, else pi's numbered display `diff`. */
export function editLines(details: unknown): EditLines | null {
	if (!isRecord(details)) return null;
	const line = typeof details.firstChangedLine === "number" ? details.firstChangedLine : null;
	let added = 0;
	let removed = 0;
	if (typeof details.patch === "string" && details.patch) {
		for (const row of details.patch.split("\n")) {
			if (row.startsWith("+++") || row.startsWith("---")) continue;
			if (row.startsWith("+")) added += 1;
			else if (row.startsWith("-")) removed += 1;
		}
	} else if (typeof details.diff === "string") {
		for (const row of details.diff.split("\n")) {
			if (/^\+\s*\d+\s/.test(row)) added += 1;
			else if (/^-\s*\d+\s/.test(row)) removed += 1;
		}
	} else return null;
	return { added, removed, line };
}

export function callFacts(
	name: string,
	args: unknown,
	redactor: Redactor,
	paths: WorkspacePaths = workspacePaths(null),
): CallFacts {
	const record = isRecord(args) ? args : {};
	const path = text(record.path) ?? text(record.file_path);
	let file = FILE_TOOLS.includes(name) && path !== null ? fileKey(path, paths, redactor) : null;
	if (file && name === "write") file = { ...file, lines: lineCount(text(record.content) ?? "") };
	const todo = (TODO_TOOLS as readonly string[]).includes(name)
		? {
				id: text(record.id),
				group:
					text(record.group) === null ? null : redactor.label(String(record.group), TITLE_CHARS),
				summary:
					name === "todo_plan_summary" && text(record.summary)
						? redactor.label(String(record.summary), NOTE_CHARS)
						: null,
				filtered: name === "todo_list" && !!text(record.status),
			}
		: null;
	const main = mainArgument(args);
	return {
		key: callKey(name, args),
		path: path === null ? null : digest(path),
		words: wordHashes(main),
		objects: objectsOf(path === null ? main : `${path} ${main}`),
		skill: skillOf(name, record, redactor, paths),
		todo,
		edit: EDIT_TOOLS.includes(name),
		writes: SHELL_TOOLS.includes(name) && shellWrites(text(record.command) ?? ""),
		file,
	};
}

/** The skill a prompt invokes: pi's expanded `<skill name="…">` block or a `/skill:name` prefix. */
export function promptSkill(prompt: string, redactor: Redactor): string | null {
	const match = PROMPT_SKILL.exec(prompt.trimStart());
	const name = match?.[1] ?? match?.[2];
	return name ? redactor.label(name, 80) : null;
}

const ERROR_STRONG =
	/\b(?:error|fatal|exception|panic|traceback)\b\s*[:[]|\(fail\)|✗|✘|\bFAIL\b|\bfailed\b|^E\d{3,}|ENOENT|EACCES|not found|no such file/i;
const ERROR_WEAK =
	/error|fail|cannot|can't|could not|not found|no such|denied|invalid|unexpected|refus|unknown|missing|timed out|abort|exception|traceback|panic|fatal/i;
const PASSING = /\(pass\)|✓|✔|\bPASS\b|^\s*0 fail\b/;

const ERROR_HEAD_CHARS = 20_000;

/** The line of an error output that best names the error: the first error-looking line, else the first. */
export function errorLine(output: string): string {
	const lines = output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !/^Command exited with code \d+$/.test(line));
	return (
		lines.find((line) => ERROR_STRONG.test(line) && !PASSING.test(line)) ??
		lines.find((line) => ERROR_WEAK.test(line) && !PASSING.test(line)) ??
		lines[0] ??
		""
	);
}

/** A cluster key: paths, ids, hex, numbers and quoted literals replaced by placeholders. */
export function normalizeError(line: string): string {
	return line
		.replace(/(?:~|\.{1,2})?\/[\w.@~+-]+(?:\/[\w.@~+-]*)+/g, "<path>")
		.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
		.replace(/\b[tg]_[0-9a-f]{6,}\b/g, "<id>")
		.replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{7,}\b/g, "<id>")
		.replace(/"[^"\n]{1,120}"/g, '"…"')
		.replace(/'[^'\n]{1,120}'/g, "'…'")
		.replace(/`[^`\n]{1,120}`/g, "`…`")
		.replace(/\b\d+(?:[.:]\d+)*\b/g, "<n>")
		.replace(/\s+/g, " ")
		.trim();
}

/** The error line and cluster key of a failure, picked from its output's masked head. */
export function failureFacts(
	name: string,
	output: string,
	redactor: Redactor,
): { errorKey: string; errorLine: string } {
	const masked = redactor.around(output, 0, ERROR_HEAD_CHARS).text;
	const line = errorLine(masked.slice(0, safeCut(masked, ERROR_HEAD_CHARS)));
	const key = `${name}: ${normalizeError(line) || "(empty)"}`;
	return {
		errorLine: redactor.label(line || "(empty)", LINE_CHARS),
		errorKey: key.length > KEY_CHARS ? `${key.slice(0, safeCut(key, KEY_CHARS - 1))}…` : key,
	};
}

const STATUS: Readonly<Record<string, PlanStatus>> = {
	pending: "pending",
	in_progress: "inProgress",
	done: "done",
} satisfies Record<TodoRecord["status"], PlanStatus>;
const GLYPH: Readonly<Record<string, PlanStatus>> = {
	" ": "pending",
	"~": "inProgress",
	x: "done",
};

function todoItem(
	value: unknown,
	group: { id: string; title: string } | null,
	redactor: Redactor,
): TodoItem | null {
	if (!isRecord(value)) return null;
	const id = text(value.id);
	if (!id) return null;
	const title = text(value.title);
	const status = text(value.status);
	const origin = text(value.origin);
	return {
		id,
		title: title === null ? null : redactor.label(title, TITLE_CHARS),
		status: status !== null && Object.hasOwn(STATUS, status) ? (STATUS[status] ?? null) : null,
		origin: origin === "agent" || origin === "user" ? origin : null,
		groupId: group?.id ?? null,
		group: group?.title ?? null,
	};
}

function groupOf(value: unknown, redactor: Redactor): { id: string; title: string } | null {
	if (!isRecord(value)) return null;
	const id = text(value.id);
	if (!id) return null;
	return { id, title: redactor.label(text(value.title) ?? "", TITLE_CHARS) };
}

function planOf(plan: Record<string, unknown>, redactor: Redactor) {
	const items: TodoItem[] = [];
	const groups: { id: string; title: string }[] = [];
	for (const raw of Array.isArray(plan.groups) ? plan.groups : []) {
		const group = groupOf(raw, redactor);
		if (!group || !isRecord(raw)) continue;
		groups.push(group);
		for (const todo of Array.isArray(raw.todos) ? raw.todos : []) {
			const item = todoItem(todo, group, redactor);
			if (item) items.push(item);
		}
	}
	for (const todo of Array.isArray(plan.todos) ? plan.todos : []) {
		const item = todoItem(todo, null, redactor);
		if (item) items.push(item);
	}
	return { items, groups };
}

/** The fallback for results without `details`: `▸ Group [status n/m]` and `[x] Title — t_…` lines. */
export function planFromText(output: string, redactor: Redactor) {
	const items: TodoItem[] = [];
	const groups: { id: string; title: string }[] = [];
	let group: { id: string; title: string } | null = null;
	for (const line of redactor.clean(output).split("\n")) {
		const header = TODO_TEXT_GROUP.exec(line);
		if (header?.[1]) {
			group = { id: `text:${header[1]}`, title: redactor.label(header[1], TITLE_CHARS) };
			groups.push(group);
			continue;
		}
		if (line.startsWith("Loose queue:")) {
			group = null;
			continue;
		}
		const item = TODO_TEXT_ITEM.exec(line);
		if (item?.[2] && item[3])
			items.push({
				id: item[3],
				title: redactor.label(item[2], TITLE_CHARS),
				status: GLYPH[item[1] ?? ""] ?? null,
				origin: null,
				groupId: group?.id ?? null,
				group: group?.title ?? null,
			});
	}
	return { items, groups };
}

/** A successful `todo_*` result, from its `details` (pi-todos) or, failing that, its text. */
export function todoResult(
	name: string,
	details: unknown,
	output: string,
	redactor: Redactor,
): TodoResult {
	const record = isRecord(details) ? details : {};
	const none: TodoResult = { kind: "none", items: [], groups: [], paused: [] };
	switch (name) {
		case "todo_write":
		case "todo_list": {
			const parsed = isRecord(record.plan)
				? planOf(record.plan, redactor)
				: planFromText(output, redactor);
			return { kind: "plan", ...parsed, paused: [] };
		}
		case "todo_add":
		case "todo_update": {
			const item =
				todoItem(record.todo, null, redactor) ?? planFromText(output, redactor).items[0] ?? null;
			if (!item) return none;
			const paused = (Array.isArray(record.paused) ? record.paused : [])
				.map((todo) => (isRecord(todo) ? text(todo.id) : null))
				.filter((id): id is string => id !== null);
			return { kind: "item", items: [item], groups: [], paused };
		}
		case "todo_promote": {
			const group = groupOf(record.group, redactor);
			return group ? { kind: "group", items: [], groups: [group], paused: [] } : none;
		}
		default:
			return none;
	}
}
