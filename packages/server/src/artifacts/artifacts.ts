import { randomUUID } from "node:crypto";
import {
	constants,
	copyFileSync,
	type Dirent,
	linkSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
	Workspace,
	WorkspaceArtifact,
	WorkspaceArtifactsSnapshot,
	WorkspaceIgnoredOutput,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { WORKSPACE_CONTEXT_DIR, WORKSPACE_TODOS_DIR } from "@thinkrail/shared/paths";
import { logger } from "../log";
import { dataDir, isChatWorkspace, loadWorkspaces } from "../persistence";
import { trashFile } from "../trash";
import { countOutputFiles, listIgnoredRoots, type OutputKind, outputChangedSince } from "./outputs";

const log = logger("artifacts");

const STORAGE_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,198}[A-Za-z0-9])?$/;
const STORE_VERSION = 1;
const CONTEXT_PREFIX = `${WORKSPACE_CONTEXT_DIR}/`;
const SCAFFOLD = `${WORKSPACE_CONTEXT_DIR}/.gitignore`;
const MAX_ARTIFACT_SCAN_ENTRIES = 5_000;
const KEPT_COPY_MAX_BYTES = 100 * 1024 * 1024;
const LINK_UNSUPPORTED = new Set<unknown>(["EXDEV", "EPERM", "EMLINK", "ENOTSUP", "EOPNOTSUPP"]);
const WRITER_TOOLS = new Set(["write", "edit", "spec_create"]);

interface ArtifactRecord {
	path: string;
	state: "live" | "deleted";
	dev: string;
	ino: string;
	size: number;
	mtimeMs: number;
	changedAt: number;
	firstSeenAt: number;
	sessionId?: string;
	kept?: string;
	keptCopy?: true;
}

interface OutputRecord {
	path: string;
	kind: OutputKind;
	firstSeenAt: number;
	changedAt: number;
	sessionId?: string;
}

interface WorkspaceArtifacts {
	records: Map<string, ArtifactRecord>;
	outputs: Map<string, OutputRecord>;
}

interface ScannedFile {
	path: string;
	dev: string;
	ino: string;
	size: number;
	mtimeMs: number;
}

interface RunWindow {
	startedAt: number;
	sessions: Set<string>;
	rootsAtStart: Promise<Map<string, OutputKind> | null>;
}

export type ArtifactSessionEvent =
	| { type: "agent_start" }
	| { type: "agent_settled" }
	| { type: "tool_execution_start"; toolName: string; args: unknown }
	| { type: "tool_execution_end"; toolName: string };

const states = new Map<string, WorkspaceArtifacts>();
const running = new Map<string, Set<string>>();
const writers = new Map<string, Map<string, string>>();
const windows = new Map<string, RunWindow>();
const removals = new Map<string, Map<string, number>>();
let publisher: ((workspaceId: string) => void) | null = null;

export function setArtifactsPublisher(publish: ((workspaceId: string) => void) | null): void {
	publisher = publish;
}

function publish(workspaceId: string): void {
	try {
		publisher?.(workspaceId);
	} catch (error) {
		log.warn("artifacts publish failed", error);
	}
}

export function isArtifactPath(path: string): boolean {
	if (!path.startsWith(CONTEXT_PREFIX) || path === SCAFFOLD) return false;
	return path !== WORKSPACE_TODOS_DIR && !path.startsWith(`${WORKSPACE_TODOS_DIR}/`);
}

export function touchesArtifacts(path: string): boolean {
	return isArtifactPath(path) || CONTEXT_PREFIX.startsWith(`${path}/`);
}

export function artifactsStoreRoot(): string {
	return join(dataDir(), "artifacts");
}

function storeDir(workspaceId: string): string | null {
	return STORAGE_ID.test(workspaceId) ? join(artifactsStoreRoot(), workspaceId) : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseArtifact(value: unknown): ArtifactRecord | null {
	if (!isObject(value)) return null;
	const { path, state, dev, ino, size, mtimeMs, changedAt, firstSeenAt, sessionId, kept } = value;
	if (
		typeof path !== "string" ||
		!isArtifactPath(path) ||
		(state !== "live" && state !== "deleted") ||
		typeof dev !== "string" ||
		typeof ino !== "string" ||
		typeof size !== "number" ||
		typeof mtimeMs !== "number" ||
		typeof changedAt !== "number" ||
		typeof firstSeenAt !== "number" ||
		(sessionId !== undefined && typeof sessionId !== "string") ||
		(kept !== undefined && (typeof kept !== "string" || !STORAGE_ID.test(kept)))
	)
		return null;
	return {
		path,
		state,
		dev,
		ino,
		size,
		mtimeMs,
		changedAt,
		firstSeenAt,
		...(sessionId ? { sessionId } : {}),
		...(kept ? { kept } : {}),
		...(value.keptCopy === true ? { keptCopy: true as const } : {}),
	};
}

function parseOutput(value: unknown): OutputRecord | null {
	if (!isObject(value)) return null;
	const { path, kind, firstSeenAt, changedAt, sessionId } = value;
	if (
		typeof path !== "string" ||
		!path ||
		path.split("/").includes("..") ||
		isAbsolute(path) ||
		(kind !== "file" && kind !== "dir") ||
		typeof firstSeenAt !== "number" ||
		typeof changedAt !== "number" ||
		(sessionId !== undefined && typeof sessionId !== "string")
	)
		return null;
	return { path, kind, firstSeenAt, changedAt, ...(sessionId ? { sessionId } : {}) };
}

function load(workspaceId: string): WorkspaceArtifacts {
	const cached = states.get(workspaceId);
	if (cached) return cached;
	const state: WorkspaceArtifacts = { records: new Map(), outputs: new Map() };
	const dir = storeDir(workspaceId);
	if (dir) {
		try {
			const raw: unknown = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
			if (isObject(raw) && raw.version === STORE_VERSION) {
				for (const item of Array.isArray(raw.artifacts) ? raw.artifacts : []) {
					const record = parseArtifact(item);
					if (record) state.records.set(record.path, record);
				}
				for (const item of Array.isArray(raw.outputs) ? raw.outputs : []) {
					const record = parseOutput(item);
					if (record) state.outputs.set(record.path, record);
				}
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				log.warn("artifacts index unreadable; starting empty", error);
		}
	}
	states.set(workspaceId, state);
	return state;
}

function save(workspaceId: string, state: WorkspaceArtifacts): void {
	const dir = storeDir(workspaceId);
	if (!dir) return;
	try {
		mkdirSync(dir, { recursive: true });
		const file = join(dir, "index.json");
		const temp = `${file}.${randomUUID()}.tmp`;
		writeFileSync(
			temp,
			JSON.stringify({
				version: STORE_VERSION,
				artifacts: [...state.records.values()],
				outputs: [...state.outputs.values()],
			}),
		);
		renameSync(temp, file);
	} catch (error) {
		log.warn("artifacts index not saved", error);
	}
}

function workspaceOf(workspaceId: string): Workspace | null {
	return loadWorkspaces().find((workspace) => workspace.id === workspaceId) ?? null;
}

function requireWorkspace(workspaceId: string): Workspace {
	const workspace = workspaceOf(workspaceId);
	if (!workspace) throw new Error(`Unknown workspace: ${workspaceId}`);
	return workspace;
}

function scanContext(root: string): { files: Map<string, ScannedFile>; complete: boolean } {
	const files = new Map<string, ScannedFile>();
	const queue = [WORKSPACE_CONTEXT_DIR];
	let seen = 0;
	for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
		let entries: Dirent[];
		try {
			entries = readdirSync(join(root, dir), { withFileTypes: true });
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT" || code === "ENOTDIR") continue;
			return { files, complete: false };
		}
		for (const entry of entries) {
			if (++seen > MAX_ARTIFACT_SCAN_ENTRIES) return { files, complete: false };
			const path = `${dir}/${entry.name}`;
			if (!isArtifactPath(path)) continue;
			if (entry.isDirectory()) {
				queue.push(path);
				continue;
			}
			if (!entry.isFile()) continue;
			const stat = lstatSync(join(root, path), { bigint: true, throwIfNoEntry: false });
			if (!stat?.isFile()) continue;
			files.set(path, {
				path,
				dev: String(stat.dev),
				ino: String(stat.ino),
				size: Number(stat.size),
				mtimeMs: Number(stat.mtimeMs),
			});
		}
	}
	return { files, complete: true };
}

function keptPath(workspaceId: string, name: string): string | null {
	const dir = storeDir(workspaceId);
	return dir ? join(dir, "kept", name) : null;
}

function dropKept(workspaceId: string, record: ArtifactRecord): void {
	if (!record.kept) return;
	const path = keptPath(workspaceId, record.kept);
	if (path) rmSync(path, { force: true });
	delete record.kept;
	delete record.keptCopy;
}

function keep(workspaceId: string, root: string, record: ArtifactRecord): void {
	dropKept(workspaceId, record);
	const name = randomUUID();
	const target = keptPath(workspaceId, name);
	if (!target) return;
	const source = join(root, record.path);
	try {
		mkdirSync(dirname(target), { recursive: true });
		linkSync(source, target);
		record.kept = name;
		return;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (!LINK_UNSUPPORTED.has(code)) {
			if (code !== "ENOENT") log.warn("artifact copy not kept", error);
			return;
		}
	}
	if (record.size > KEPT_COPY_MAX_BYTES) return;
	try {
		copyFileSync(source, target);
		record.kept = name;
		record.keptCopy = true;
	} catch (error) {
		rmSync(target, { force: true });
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			log.warn("artifact copy not kept", error);
	}
}

function covered(marks: Map<string, number> | undefined, path: string): boolean {
	if (!marks) return false;
	for (const mark of marks.keys()) if (path === mark || path.startsWith(`${mark}/`)) return true;
	return false;
}

function writerOf(workspaceId: string, path: string): string | undefined {
	const explicit = writers.get(workspaceId)?.get(path);
	if (explicit) return explicit;
	const active = running.get(workspaceId);
	return active?.size === 1 ? [...active][0] : undefined;
}

function applyStat(record: ArtifactRecord, file: ScannedFile): void {
	record.dev = file.dev;
	record.ino = file.ino;
	record.size = file.size;
	record.mtimeMs = file.mtimeMs;
	record.changedAt = Math.round(file.mtimeMs);
}

function reconcile(workspace: Workspace): boolean {
	const workspaceId = workspace.id;
	const root = workspace.worktreePath;
	const state = load(workspaceId);
	const { files, complete } = scanContext(root);
	const unseen = new Map(files);
	const missing: ArtifactRecord[] = [];
	let changed = false;

	for (const record of state.records.values()) {
		if (record.state !== "live") continue;
		const file = files.get(record.path);
		if (!file) {
			missing.push(record);
			continue;
		}
		unseen.delete(record.path);
		const relinked = file.dev !== record.dev || file.ino !== record.ino;
		if (!relinked && file.size === record.size && file.mtimeMs === record.mtimeMs) continue;
		applyStat(record, file);
		const writer = writerOf(workspaceId, record.path);
		if (writer) record.sessionId = writer;
		if (relinked || record.keptCopy || !record.kept) keep(workspaceId, root, record);
		changed = true;
	}

	for (const record of missing.splice(0)) {
		const moved = [...unseen.values()].find(
			(file) => file.dev === record.dev && file.ino === record.ino,
		);
		if (!moved) {
			missing.push(record);
			continue;
		}
		const replaced = state.records.get(moved.path);
		if (replaced) dropKept(workspaceId, replaced);
		state.records.delete(record.path);
		record.path = moved.path;
		applyStat(record, moved);
		if (record.keptCopy || !record.kept) keep(workspaceId, root, record);
		state.records.set(record.path, record);
		unseen.delete(moved.path);
		changed = true;
	}

	if (complete) {
		const now = Date.now();
		const marks = removals.get(workspaceId);
		for (const record of missing) {
			if (covered(marks, record.path) || !record.kept) {
				dropKept(workspaceId, record);
				state.records.delete(record.path);
			} else {
				record.state = "deleted";
				record.changedAt = now;
			}
			changed = true;
		}
	}

	for (const file of unseen.values()) {
		const prior = state.records.get(file.path);
		if (prior) dropKept(workspaceId, prior);
		const record: ArtifactRecord = {
			path: file.path,
			state: "live",
			dev: file.dev,
			ino: file.ino,
			size: file.size,
			mtimeMs: file.mtimeMs,
			changedAt: Math.round(file.mtimeMs),
			firstSeenAt: prior?.firstSeenAt ?? Date.now(),
		};
		const writer = writerOf(workspaceId, file.path) ?? prior?.sessionId;
		if (writer) record.sessionId = writer;
		keep(workspaceId, root, record);
		state.records.set(file.path, record);
		changed = true;
	}

	if (changed) save(workspaceId, state);
	return changed;
}

export function reconcileArtifacts(workspaceId: string): boolean {
	const workspace = workspaceOf(workspaceId);
	if (!workspace) return false;
	const changed = reconcile(workspace);
	if (changed) publish(workspaceId);
	return changed;
}

export async function withUserRemoval<T>(
	workspaceId: string,
	path: string,
	mutation: () => Promise<T>,
): Promise<T> {
	if (!isArtifactPath(path) && !touchesArtifacts(path)) return mutation();
	let marks = removals.get(workspaceId);
	if (!marks) {
		marks = new Map();
		removals.set(workspaceId, marks);
	}
	marks.set(path, (marks.get(path) ?? 0) + 1);
	try {
		const result = await mutation();
		reconcileArtifacts(workspaceId);
		return result;
	} finally {
		const count = (marks.get(path) ?? 1) - 1;
		if (count > 0) marks.set(path, count);
		else marks.delete(path);
		if (marks.size === 0) removals.delete(workspaceId);
	}
}

function toWire(record: ArtifactRecord): WorkspaceArtifact {
	return {
		path: record.path,
		state: record.state,
		size: record.size,
		changedAt: record.changedAt,
		firstSeenAt: record.firstSeenAt,
		...(record.sessionId ? { sessionId: record.sessionId } : {}),
	};
}

async function detectOutputs(workspace: Workspace, window: RunWindow): Promise<boolean> {
	const before = await window.rootsAtStart;
	if (!before) return false;
	const roots = await listIgnoredRoots(workspace.worktreePath);
	if (!roots) return false;
	const state = load(workspace.id);
	const sessionId = window.sessions.size === 1 ? [...window.sessions][0] : undefined;
	const now = Date.now();
	let changed = false;
	for (const [path, kind] of roots) {
		const prior = state.outputs.get(path);
		if (prior && prior.changedAt >= window.startedAt && prior.kind === kind) continue;
		const fresh = !before.has(path);
		if (!fresh && !outputChangedSince(join(workspace.worktreePath, path), kind, window.startedAt))
			continue;
		const writer = sessionId ?? prior?.sessionId;
		state.outputs.set(path, {
			path,
			kind,
			firstSeenAt: prior?.firstSeenAt ?? now,
			changedAt: now,
			...(writer ? { sessionId: writer } : {}),
		});
		changed = true;
	}
	if (changed) save(workspace.id, state);
	return changed;
}

function liveOutputs(workspace: Workspace): WorkspaceIgnoredOutput[] {
	const state = load(workspace.id);
	const outputs: WorkspaceIgnoredOutput[] = [];
	let changed = false;
	for (const record of state.outputs.values()) {
		const abs = join(workspace.worktreePath, record.path);
		const stat = lstatSync(abs, { throwIfNoEntry: false });
		const kind: OutputKind | null = stat?.isDirectory() ? "dir" : stat?.isFile() ? "file" : null;
		if (!kind) {
			state.outputs.delete(record.path);
			changed = true;
			continue;
		}
		const { files, truncated } = countOutputFiles(abs, kind);
		outputs.push({
			path: record.path,
			kind,
			files,
			filesTruncated: truncated,
			changedAt: record.changedAt,
			...(record.sessionId ? { sessionId: record.sessionId } : {}),
		});
	}
	if (changed) save(workspace.id, state);
	return outputs.sort((a, b) => b.changedAt - a.changedAt);
}

export async function listArtifacts(workspaceId: string): Promise<WorkspaceArtifactsSnapshot> {
	const workspace = requireWorkspace(workspaceId);
	if (reconcile(workspace)) publish(workspaceId);
	let outputs: WorkspaceIgnoredOutput[] | null = null;
	if (!isChatWorkspace(workspace)) {
		const window = windows.get(workspaceId);
		if (window && (await detectOutputs(workspace, window))) publish(workspaceId);
		outputs = liveOutputs(workspace);
	}
	const artifacts = [...load(workspaceId).records.values()]
		.map(toWire)
		.sort((a, b) => b.changedAt - a.changedAt);
	return { workspaceId, dir: WORKSPACE_CONTEXT_DIR, artifacts, outputs };
}

function deletedRecord(
	workspaceId: string,
	path: string,
): { record: ArtifactRecord; kept: string; dir: string } {
	const record = load(workspaceId).records.get(path);
	const dir = storeDir(workspaceId);
	if (record?.state !== "deleted" || !record.kept || !dir)
		throw new CodedError("ARTIFACT_UNKNOWN", `No kept copy of ${path}`);
	return { record, kept: join(dir, "kept", record.kept), dir };
}

function isInside(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function restoreArtifact(workspaceId: string, path: string): void {
	const workspace = requireWorkspace(workspaceId);
	const { record, kept } = deletedRecord(workspaceId, path);
	const root = workspace.worktreePath;
	const target = resolve(root, path);
	if (lstatSync(target, { throwIfNoEntry: false }))
		throw new CodedError("ENTRY_EXISTS", `${path} already exists`);
	let existing = dirname(target);
	while (!lstatSync(existing, { throwIfNoEntry: false })) existing = dirname(existing);
	if (!isInside(realpathSync(root), realpathSync(existing)))
		throw new Error("Path escapes the worktree");
	mkdirSync(dirname(target), { recursive: true });
	if (record.keptCopy) copyFileSync(kept, target, constants.COPYFILE_EXCL);
	else {
		try {
			linkSync(kept, target);
		} catch (error) {
			if (!LINK_UNSUPPORTED.has((error as NodeJS.ErrnoException).code)) throw error;
			copyFileSync(kept, target, constants.COPYFILE_EXCL);
		}
	}
	record.state = "live";
	reconcile(workspace);
	save(workspaceId, load(workspaceId));
	publish(workspaceId);
}

export async function discardArtifact(workspaceId: string, path: string): Promise<void> {
	requireWorkspace(workspaceId);
	const { kept, dir } = deletedRecord(workspaceId, path);
	const staging = join(dir, "discard", randomUUID());
	const staged = join(staging, basename(path));
	mkdirSync(staging, { recursive: true });
	renameSync(kept, staged);
	try {
		await trashFile(staged);
	} catch (error) {
		renameSync(staged, kept);
		throw error;
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
	const state = load(workspaceId);
	state.records.delete(path);
	save(workspaceId, state);
	publish(workspaceId);
}

function toolPath(args: unknown): string | null {
	if (!isObject(args)) return null;
	const path = args.path ?? args.file_path;
	return typeof path === "string" && path ? path : null;
}

function rememberWriter(workspace: Workspace, sessionId: string, args: unknown): void {
	const path = toolPath(args);
	if (!path) return;
	const root = resolve(workspace.worktreePath);
	const abs = resolve(root, path);
	if (!isInside(root, abs)) return;
	const rel = relative(root, abs).split(sep).join("/");
	if (!isArtifactPath(rel)) return;
	let map = writers.get(workspace.id);
	if (!map) {
		map = new Map();
		writers.set(workspace.id, map);
	}
	map.set(rel, sessionId);
}

function forgetWriters(workspaceId: string, sessionId: string): void {
	const map = writers.get(workspaceId);
	if (!map) return;
	for (const [path, writer] of map) if (writer === sessionId) map.delete(path);
	if (map.size === 0) writers.delete(workspaceId);
}

function openWindow(workspace: Workspace, sessionId: string): void {
	const open = windows.get(workspace.id);
	if (open) {
		open.sessions.add(sessionId);
		return;
	}
	const rootsAtStart = isChatWorkspace(workspace)
		? Promise.resolve(null)
		: listIgnoredRoots(workspace.worktreePath).catch((error) => {
				log.warn("ignored outputs baseline failed", error);
				return null;
			});
	windows.set(workspace.id, {
		startedAt: Date.now(),
		sessions: new Set([sessionId]),
		rootsAtStart,
	});
}

export async function observeArtifactSessionEvent(
	workspaceId: string,
	sessionId: string,
	event: ArtifactSessionEvent,
): Promise<void> {
	const workspace = workspaceOf(workspaceId);
	if (!workspace) return;
	switch (event.type) {
		case "agent_start": {
			let active = running.get(workspaceId);
			if (!active) {
				active = new Set();
				running.set(workspaceId, active);
			}
			active.add(sessionId);
			openWindow(workspace, sessionId);
			if (reconcile(workspace)) publish(workspaceId);
			return;
		}
		case "tool_execution_start":
			if (WRITER_TOOLS.has(event.toolName)) rememberWriter(workspace, sessionId, event.args);
			return;
		case "tool_execution_end":
			if (reconcile(workspace)) publish(workspaceId);
			return;
		case "agent_settled": {
			let changed = reconcile(workspace);
			forgetWriters(workspaceId, sessionId);
			const active = running.get(workspaceId);
			active?.delete(sessionId);
			if (active?.size === 0) {
				running.delete(workspaceId);
				const window = windows.get(workspaceId);
				windows.delete(workspaceId);
				if (window && !isChatWorkspace(workspace))
					changed = (await detectOutputs(workspace, window)) || changed;
			}
			if (changed) publish(workspaceId);
			return;
		}
	}
}

export function removeWorkspaceArtifacts(workspaceId: string): void {
	states.delete(workspaceId);
	running.delete(workspaceId);
	writers.delete(workspaceId);
	windows.delete(workspaceId);
	removals.delete(workspaceId);
	const dir = storeDir(workspaceId);
	if (dir) rmSync(dir, { recursive: true, force: true });
}

export function resetArtifactsForTests(): void {
	states.clear();
	running.clear();
	writers.clear();
	windows.clear();
	removals.clear();
	publisher = null;
}
