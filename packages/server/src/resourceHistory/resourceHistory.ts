import { randomUUID } from "node:crypto";
import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, sep } from "node:path";
import {
	compareResourceHistory,
	interruptedResource,
	isLiveResource,
	type ResourceHistoryCursor,
	type ResourceKind,
	type ResourceRecord,
	resourceHistoryCursor,
	resourceRecordId,
} from "@thinkrail/contracts";
import { logger } from "../log";
import { dataDir } from "../persistence";

const log = logger("resource-history");

const STORAGE_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,198}[A-Za-z0-9])?$/;
const CACHED_CHATS = 64;
const COMMAND_STATUSES = new Set(["running", "stopping", "completed", "error", "stopped"]);
const SUBAGENT_STATUSES = new Set(["queued", "running", "completed", "error", "aborted"]);

export interface ResourceHistoryScope {
	workspaceId: string;
	sessionId: string;
}

export interface ArchivedOutput {
	text: string;
	truncated: boolean;
}

interface ChatHistory {
	records: Map<string, ResourceRecord>;
	serialized: Map<string, string>;
	needsNewline: boolean;
}

const cache = new Map<string, ChatHistory>();

export function resourceHistoryRoot(): string {
	return join(dataDir(), "resource-history");
}

function chatDir(scope: ResourceHistoryScope): string | null {
	return STORAGE_ID.test(scope.workspaceId) && STORAGE_ID.test(scope.sessionId)
		? join(resourceHistoryRoot(), scope.workspaceId, scope.sessionId)
		: null;
}

function keyOf(record: ResourceRecord): string {
	return `${record.kind}:${resourceRecordId(record)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseRecord(value: unknown): ResourceRecord | null {
	if (!isRecord(value) || !isRecord(value.summary)) return null;
	const summary = value.summary;
	if (
		value.kind === "command" &&
		typeof summary.id === "string" &&
		typeof summary.sessionId === "string" &&
		typeof summary.name === "string" &&
		typeof summary.command === "string" &&
		typeof summary.status === "string" &&
		COMMAND_STATUSES.has(summary.status) &&
		typeof summary.startedAt === "number"
	)
		return value as ResourceRecord;
	if (
		value.kind === "subagent" &&
		typeof summary.childSessionId === "string" &&
		typeof summary.parentSessionId === "string" &&
		typeof summary.task === "string" &&
		typeof summary.status === "string" &&
		SUBAGENT_STATUSES.has(summary.status) &&
		typeof summary.createdAt === "string"
	)
		return value as ResourceRecord;
	return null;
}

function readIndex(dir: string): ChatHistory {
	const history: ChatHistory = { records: new Map(), serialized: new Map(), needsNewline: false };
	let text: string;
	try {
		text = readFileSync(join(dir, "index.jsonl"), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			log.warn("resource history index could not be read", error);
		return history;
	}
	history.needsNewline = text.length > 0 && !text.endsWith("\n");
	for (const line of text.split("\n")) {
		if (!line) continue;
		let record: ResourceRecord | null;
		try {
			record = parseRecord(JSON.parse(line));
		} catch {
			record = null;
		}
		if (!record) continue;
		history.records.set(keyOf(record), record);
		history.serialized.set(keyOf(record), JSON.stringify(record.summary));
	}
	return history;
}

function load(dir: string): ChatHistory {
	let history = cache.get(dir);
	if (history) cache.delete(dir);
	else history = readIndex(dir);
	cache.set(dir, history);
	while (cache.size > CACHED_CHATS) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
	}
	return history;
}

function writeAtomic(path: string, content: string): void {
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, content);
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}

export function recordResource(
	scope: ResourceHistoryScope,
	record: ResourceRecord,
	output?: ArchivedOutput,
): void {
	const dir = chatDir(scope);
	if (!dir || !STORAGE_ID.test(resourceRecordId(record))) return;
	try {
		const history = load(dir);
		const key = keyOf(record);
		const serialized = JSON.stringify(record.summary);
		if (history.serialized.get(key) === serialized) return;
		mkdirSync(join(dir, "logs"), { recursive: true });
		if (record.kind === "command" && output && !isLiveResource(record))
			writeAtomic(
				join(dir, "logs", `${resourceRecordId(record)}.json`),
				JSON.stringify({ text: output.text, truncated: output.truncated }),
			);
		const line = `${JSON.stringify({ kind: record.kind, summary: record.summary })}\n`;
		try {
			appendFileSync(join(dir, "index.jsonl"), history.needsNewline ? `\n${line}` : line);
		} catch (error) {
			history.needsNewline = true;
			throw error;
		}
		history.needsNewline = false;
		history.records.set(key, record);
		history.serialized.set(key, serialized);
	} catch (error) {
		log.warn("resource history could not be written", error);
	}
}

export function finishedResources(
	scope: ResourceHistoryScope,
	kind: ResourceKind,
	live: ReadonlySet<string>,
): ResourceRecord[] {
	const dir = chatDir(scope);
	if (!dir) return [];
	const finished: ResourceRecord[] = [];
	for (const record of load(dir).records.values()) {
		if (record.kind !== kind || live.has(resourceRecordId(record))) continue;
		finished.push(
			record.summary.interrupted || isLiveResource(record) ? interruptedResource(record) : record,
		);
	}
	return finished.sort((a, b) =>
		compareResourceHistory(resourceHistoryCursor(a), resourceHistoryCursor(b)),
	);
}

export function pageResources(
	records: readonly ResourceRecord[],
	before: ResourceHistoryCursor | undefined,
	limit: number,
): { items: ResourceRecord[]; hasMore: boolean } {
	const older = before
		? records.filter((record) => compareResourceHistory(before, resourceHistoryCursor(record)) < 0)
		: records;
	return { items: older.slice(0, limit), hasMore: older.length > limit };
}

export function archivedCommandOutput(
	scope: ResourceHistoryScope,
	commandId: string,
): ArchivedOutput | undefined {
	const dir = chatDir(scope);
	if (!dir || !STORAGE_ID.test(commandId)) return undefined;
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(join(dir, "logs", `${commandId}.json`), "utf8"),
		);
		return isRecord(parsed) &&
			typeof parsed.text === "string" &&
			typeof parsed.truncated === "boolean"
			? { text: parsed.text, truncated: parsed.truncated }
			: undefined;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			log.warn("resource history log could not be read", error);
		return undefined;
	}
}

export function removeWorkspaceResourceHistory(workspaceId: string): void {
	if (!STORAGE_ID.test(workspaceId)) return;
	const dir = join(resourceHistoryRoot(), workspaceId);
	for (const key of [...cache.keys()]) if (key.startsWith(`${dir}${sep}`)) cache.delete(key);
	rmSync(dir, { recursive: true, force: true });
}
