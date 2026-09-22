import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildSessionContext,
	type SessionEntry,
	type SessionHeader,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { scanReplayTools } from "./replayTools";
import { type CapturedHistory, DelegationError, type HistoryCaptureSource } from "./types";

function invalid(message: string): never {
	throw new DelegationError("invalid-history", message);
}

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
	return typeof value === "string";
}

function nonempty(value: unknown): value is string {
	return text(value) && value.length > 0;
}

function timestamp(value: unknown): boolean {
	return text(value) && Number.isFinite(Date.parse(value));
}

function content(value: unknown, kinds: readonly string[] = ["text", "image"]): boolean {
	return (
		Array.isArray(value) &&
		value.every((block: unknown) => {
			if (!object(block) || !kinds.includes(String(block.type))) return false;
			switch (block.type) {
				case "text":
					return text(block.text);
				case "thinking":
					return text(block.thinking);
				case "image":
					return text(block.data) && nonempty(block.mimeType);
				case "toolCall":
					return nonempty(block.id) && nonempty(block.name) && object(block.arguments);
				default:
					return false;
			}
		})
	);
}

function message(value: unknown): boolean {
	if (!object(value) || typeof value.timestamp !== "number") return false;
	if (value.role === "user") return text(value.content) || content(value.content);
	if (value.role === "toolResult") {
		return (
			nonempty(value.toolCallId) &&
			nonempty(value.toolName) &&
			content(value.content) &&
			typeof value.isError === "boolean"
		);
	}
	if (value.role === "bashExecution")
		return (
			text(value.command) &&
			text(value.output) &&
			(value.exitCode === undefined || typeof value.exitCode === "number") &&
			typeof value.cancelled === "boolean" &&
			typeof value.truncated === "boolean"
		);
	if (value.role === "custom")
		return (
			nonempty(value.customType) &&
			(text(value.content) || content(value.content)) &&
			typeof value.display === "boolean"
		);
	if (value.role === "branchSummary") return text(value.summary) && nonempty(value.fromId);
	if (value.role === "compactionSummary")
		return text(value.summary) && typeof value.tokensBefore === "number";
	if (value.role !== "assistant" || !content(value.content, ["text", "thinking", "toolCall"]))
		return false;
	if (!nonempty(value.api) || !nonempty(value.provider) || !nonempty(value.model)) return false;
	if (
		!["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"].includes(
			String(value.stopReason),
		)
	)
		return false;
	const usage = value.usage;
	if (!object(usage) || !object(usage.cost)) return false;
	return (
		["input", "output", "cacheRead", "cacheWrite", "totalTokens"].every(
			(key) => typeof usage[key] === "number",
		) &&
		["input", "output", "cacheRead", "cacheWrite", "total"].every(
			(key) => object(usage.cost) && typeof usage.cost[key] === "number",
		)
	);
}

function entryShape(entry: Record<string, unknown>): boolean {
	switch (entry.type) {
		case "message":
			return message(entry.message);
		case "model_change":
			return nonempty(entry.provider) && nonempty(entry.modelId);
		case "thinking_level_change":
			return ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
				String(entry.thinkingLevel),
			);
		case "compaction":
			return (
				text(entry.summary) &&
				nonempty(entry.firstKeptEntryId) &&
				typeof entry.tokensBefore === "number"
			);
		case "branch_summary":
			return text(entry.summary) && nonempty(entry.fromId);
		case "label":
			return nonempty(entry.targetId) && (entry.label === undefined || text(entry.label));
		case "session_info":
			return entry.name === undefined || text(entry.name);
		case "custom":
			return nonempty(entry.customType);
		case "custom_message":
			return (
				nonempty(entry.customType) &&
				(text(entry.content) || content(entry.content)) &&
				typeof entry.display === "boolean"
			);
		default:
			return false;
	}
}

export interface Transcript {
	header: SessionHeader;
	entries: SessionEntry[];
}

export function parseTranscript(jsonl: string, sessionId: string): Transcript {
	if (!jsonl.endsWith("\n")) invalid("Transcript must be newline-ended JSONL");
	let values: unknown[];
	try {
		values = jsonl
			.slice(0, -1)
			.split("\n")
			.map((line) => JSON.parse(line));
	} catch {
		invalid("Malformed transcript JSONL");
	}
	const header = values[0];
	if (
		!object(header) ||
		header.type !== "session" ||
		header.version !== 3 ||
		header.id !== sessionId ||
		!nonempty(header.id) ||
		!text(header.cwd) ||
		!timestamp(header.timestamp) ||
		(header.parentSession !== undefined && !text(header.parentSession))
	)
		invalid("Invalid pi v3 session header or identity");
	const byId = new Map<string, SessionEntry>();
	const entries: SessionEntry[] = [];
	for (const value of values.slice(1)) {
		if (
			!object(value) ||
			!nonempty(value.id) ||
			byId.has(value.id) ||
			!timestamp(value.timestamp) ||
			!(value.parentId === null || (nonempty(value.parentId) && byId.has(value.parentId))) ||
			!entryShape(value)
		) {
			invalid("Invalid entry, duplicate id or broken ancestry");
		}
		const entry = value as unknown as SessionEntry;
		if (entry.type === "compaction") {
			let ancestor = entry.parentId === null ? undefined : byId.get(entry.parentId);
			while (ancestor && ancestor.id !== entry.firstKeptEntryId) {
				ancestor = ancestor.parentId === null ? undefined : byId.get(ancestor.parentId);
			}
			if (!ancestor) invalid("Compaction firstKeptEntryId is not on its ancestor path");
		}
		byId.set(entry.id, entry);
		entries.push(entry);
	}
	return { header: header as unknown as SessionHeader, entries };
}

export function branchAt(transcript: Transcript, entryId: string | null): SessionEntry[] {
	if (entryId === null) return [];
	const byId = new Map(transcript.entries.map((entry) => [entry.id, entry]));
	let entry = byId.get(entryId);
	if (!entry) invalid(`Missing cut ${entryId}`);
	const branch: SessionEntry[] = [];
	while (entry) {
		branch.push(entry);
		entry = entry.parentId === null ? undefined : byId.get(entry.parentId);
	}
	return branch.reverse();
}

function digest(jsonl: string): string {
	return createHash("sha256").update(jsonl, "utf8").digest("hex");
}

function serialize(header: SessionHeader, branch: SessionEntry[]): string {
	try {
		return `${[header, ...branch].map((entry) => JSON.stringify(entry)).join("\n")}\n`;
	} catch {
		invalid("Session history cannot be serialized as JSONL");
	}
}

export function captureBranch(transcript: Transcript, entryId: string | null): CapturedHistory {
	const branch = branchAt(transcript, entryId);
	const jsonl = serialize(transcript.header, branch);
	const history: CapturedHistory = {
		format: "pi-session-branch-v1",
		sourceSessionId: transcript.header.id,
		entryId,
		sha256: digest(jsonl),
		sizeBytes: Buffer.byteLength(jsonl, "utf8"),
		jsonl,
	};
	validateHistory(history);
	return Object.freeze(history);
}

export function validateHistory(history: CapturedHistory): Transcript {
	if (
		history.format !== "pi-session-branch-v1" ||
		typeof history.jsonl !== "string" ||
		history.sizeBytes !== Buffer.byteLength(history.jsonl, "utf8") ||
		history.sha256 !== digest(history.jsonl) ||
		!(history.entryId === null || nonempty(history.entryId))
	)
		invalid("Invalid capture format, boundary, digest or length");
	const transcript = parseTranscript(history.jsonl, history.sourceSessionId);
	const branch = branchAt(transcript, history.entryId);
	if (
		branch.length !== transcript.entries.length ||
		branch.some((entry, index) => entry.id !== transcript.entries[index]?.id)
	) {
		invalid("Capture does not end exactly at its declared cut");
	}
	const { messages } = buildSessionContext(branch, history.entryId);
	const { issues } = scanReplayTools(messages);
	if (issues.length) throw new DelegationError("incomplete-history", issues.join("; "));
	return transcript;
}

export function captureSession(
	source: Extract<HistoryCaptureSource, { kind: "session" }>,
): CapturedHistory {
	const manager = source.sessionManager;
	if (manager.getSessionId() !== source.sessionId) invalid("Session manager identity mismatch");
	const header = manager.getHeader();
	if (!header) throw new DelegationError("history-unavailable", "Source has no session header");
	let entryId: string | null;
	let branch: SessionEntry[];
	if (source.cut.kind === "at-entry") {
		entryId = source.cut.entryId;
		branch = entryId === null ? [] : manager.getBranch(entryId);
	} else {
		branch = parseTranscript(serialize(header, manager.getBranch()), source.sessionId).entries;
		const toolCallId = source.cut.toolCallId;
		const matches = branch.flatMap((entry) =>
			entry.type === "message" && entry.message.role === "assistant"
				? entry.message.content
						.filter((block) => block.type === "toolCall" && block.id === toolCallId)
						.map(() => entry)
				: [],
		);
		if (matches.length !== 1 || !matches[0]) invalid("Missing or ambiguous calling tool batch");
		entryId = matches[0].parentId;
		branch = entryId === null ? [] : manager.getBranch(entryId);
	}
	const jsonl = serialize(header, branch);
	return captureBranch(parseTranscript(jsonl, source.sessionId), entryId);
}

export function forkCaptured(
	history: CapturedHistory,
	cwd: string,
	sessionDir: string,
): SessionManager {
	validateHistory(history);
	const dir = mkdtempSync(join(tmpdir(), "pi-delegation-seed-"));
	try {
		const file = join(dir, "seed.jsonl");
		writeFileSync(file, history.jsonl, { mode: 0o600, flag: "wx" });
		return SessionManager.forkFrom(file, cwd, sessionDir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
