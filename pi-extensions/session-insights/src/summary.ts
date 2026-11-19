import {
	CURRENT_SESSION_VERSION,
	type FileEntry,
	migrateSessionEntries,
} from "@earendil-works/pi-coding-agent";
import {
	FIRST_PROMPT_CHARS,
	SUBAGENT_COMPLETION_MESSAGE,
	SUBAGENT_TOOLS,
	SUBAGENT_USAGE_KIND,
	UNFINISHED_RUN_STATUSES,
} from "./core.ts";
import { type ByteRange, type ParsedLine, scanBytes } from "./lines.ts";
import { type Redactor, safeCut } from "./redact.ts";
import {
	addSpend,
	emptySpend,
	isRecord,
	type Spend,
	type SpendTotals,
	spendOf,
	tokensOf,
	usageSpend,
} from "./totals.ts";

export const PARSER_VERSION = 1;
export const ACTIVE_GAP_MS = 5 * 60 * 1000;

export interface SessionCounts {
	entries: number;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	toolErrors: number;
	compactions: number;
	modelChanges: number;
}

export interface ToolUse {
	calls: number;
	errors: number;
}

export interface ModelUse {
	messages: number;
	tokens: number;
	cost: number;
}

export interface SubagentRef {
	childId: string;
	mirrored: SpendTotals | null;
	reported: SpendTotals | null;
	status: string | null;
}

export interface SessionSummary {
	sessionId: string;
	cwd: string;
	file: string;
	parentSession: string | null;
	title: string | null;
	firstPrompt: ByteRange | null;
	start: number | null;
	end: number | null;
	activeMs: number;
	counts: SessionCounts;
	tools: Readonly<Record<string, ToolUse>>;
	stopReasons: Readonly<Record<string, number>>;
	spend: SpendTotals;
	models: Readonly<Record<string, ModelUse>>;
	subagents: Readonly<Record<string, SubagentRef>>;
}

interface HeaderState {
	id: string;
	cwd: string;
	version: number;
	timestamp: number | null;
	parentSession: string | null;
}

interface SubagentState extends SubagentRef {
	runs: string[];
}

export interface SummaryState {
	header: HeaderState | null;
	invalid: boolean;
	title: string | null;
	firstPrompt: ByteRange | null;
	start: number | null;
	end: number | null;
	latest: number | null;
	activeMs: number;
	counts: SessionCounts;
	tools: Record<string, ToolUse>;
	stopReasons: Record<string, number>;
	spend: SpendTotals;
	models: Record<string, ModelUse>;
	subagents: Record<string, SubagentState>;
}

function emptyState(): SummaryState {
	return {
		header: null,
		invalid: false,
		title: null,
		firstPrompt: null,
		start: null,
		end: null,
		latest: null,
		activeMs: 0,
		counts: {
			entries: 0,
			userMessages: 0,
			assistantMessages: 0,
			toolCalls: 0,
			toolResults: 0,
			toolErrors: 0,
			compactions: 0,
			modelChanges: 0,
		},
		tools: {},
		stopReasons: {},
		spend: emptySpend(),
		models: {},
		subagents: {},
	};
}

function cloneState(state: SummaryState): SummaryState {
	return structuredClone(state);
}

function slot<T>(map: Record<string, T>, key: string, create: () => T): T {
	const existing = Object.hasOwn(map, key) ? map[key] : undefined;
	if (existing !== undefined) return existing;
	const value = create();
	Object.defineProperty(map, key, { value, enumerable: true, writable: true, configurable: true });
	return value;
}

function text(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function timeOf(value: unknown): number | null {
	if (typeof value !== "string") return null;
	const time = Date.parse(value);
	return Number.isFinite(time) ? time : null;
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((block) =>
			isRecord(block) && block.type === "text" && typeof block.text === "string"
				? [block.text]
				: [],
		)
		.join(" ");
}

/**
 * A user message's one-line excerpt: its head masked first (home folder, secrets; `Redactor.around`), then
 * whitespace collapsed and cut to `FIRST_PROMPT_CHARS` with an ellipsis, never inside a mask.
 */
export function promptExcerpt(entry: unknown, redactor: Redactor): string | null {
	if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) return null;
	if (entry.message.role !== "user") return null;
	const text = messageText(entry.message.content);
	const collapsed = redactor.around(text, 0, FIRST_PROMPT_CHARS).text.replace(/\s+/g, " ").trim();
	if (!collapsed) return null;
	if (collapsed.length <= FIRST_PROMPT_CHARS) return collapsed;
	let cut = FIRST_PROMPT_CHARS - 1;
	const last = collapsed.charCodeAt(cut - 1);
	if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
	return `${collapsed.slice(0, safeCut(collapsed, cut)).trimEnd()}…`;
}

function headerOf(entry: unknown): HeaderState | null {
	if (!isRecord(entry) || entry.type !== "session" || typeof entry.id !== "string") return null;
	return {
		id: entry.id,
		cwd: text(entry.cwd) ?? "",
		version: typeof entry.version === "number" ? entry.version : 1,
		timestamp: timeOf(entry.timestamp),
		parentSession: text(entry.parentSession),
	};
}

function detailsSpend(usage: unknown): Spend | null {
	return isRecord(usage) ? usageSpend({ ...usage, cost: { total: usage.cost } }) : null;
}

function subagent(state: SummaryState, childId: string): SubagentState {
	return slot(state.subagents, childId, () => ({
		childId,
		mirrored: null,
		reported: null,
		status: null,
		runs: [],
	}));
}

function foldRunDetails(state: SummaryState, details: unknown): void {
	if (!isRecord(details)) return;
	const childId = text(details.childSessionId);
	if (!childId) return;
	const ref = subagent(state, childId);
	const status = text(details.status);
	if (status !== null) ref.status = status;
	if (status === null || UNFINISHED_RUN_STATUSES.includes(status)) return;
	const spend = detailsSpend(details.usage);
	if (!spend) return;
	const duration = typeof details.durationMs === "number" ? details.durationMs : null;
	const run = [spend.input, spend.output, spend.cacheRead, spend.cacheWrite, spend.cost, duration]
		.map(String)
		.join(":");
	if (ref.runs.includes(run)) return;
	ref.runs.push(run);
	ref.reported ??= emptySpend();
	addSpend(ref.reported, spend);
}

function foldTime(state: SummaryState, time: number | null): void {
	if (time === null) return;
	state.start = state.start === null ? time : Math.min(state.start, time);
	state.end = state.end === null ? time : Math.max(state.end, time);
	if (state.latest !== null && time > state.latest) {
		const gap = time - state.latest;
		if (gap < ACTIVE_GAP_MS) state.activeMs += gap;
	}
	state.latest = state.latest === null ? time : Math.max(state.latest, time);
}

function foldAssistant(state: SummaryState, message: Record<string, unknown>, spend: Spend | null) {
	state.counts.assistantMessages += 1;
	const stop = text(message.stopReason);
	if (stop !== null) state.stopReasons[stop] = slot(state.stopReasons, stop, () => 0) + 1;
	if (Array.isArray(message.content)) {
		for (const block of message.content) {
			if (!isRecord(block) || block.type !== "toolCall") continue;
			state.counts.toolCalls += 1;
			slot(state.tools, text(block.name) ?? "", () => ({ calls: 0, errors: 0 })).calls += 1;
		}
	}
	const provider = text(message.provider);
	const model = text(message.responseModel) ?? text(message.model);
	if (provider === null || model === null) return;
	const use = slot(state.models, `${provider}/${model}`, () => ({
		messages: 0,
		tokens: 0,
		cost: 0,
	}));
	use.messages += 1;
	if (spend) {
		use.tokens += tokensOf(spend);
		use.cost += spend.cost;
	}
}

function foldToolResult(state: SummaryState, message: Record<string, unknown>): void {
	state.counts.toolResults += 1;
	const name = text(message.toolName) ?? "";
	if (message.isError === true) {
		state.counts.toolErrors += 1;
		slot(state.tools, name, () => ({ calls: 0, errors: 0 })).errors += 1;
	}
	if (SUBAGENT_TOOLS.includes(name)) foldRunDetails(state, message.details);
}

function foldMessage(
	state: SummaryState,
	message: Record<string, unknown>,
	spend: Spend | null,
	range: ByteRange,
): void {
	switch (message.role) {
		case "user":
			state.counts.userMessages += 1;
			if (state.firstPrompt === null && messageText(message.content).trim())
				state.firstPrompt = range;
			return;
		case "assistant":
			foldAssistant(state, message, spend);
			return;
		case "toolResult":
			foldToolResult(state, message);
			return;
	}
}

function foldEntry(state: SummaryState, entry: unknown, range: ByteRange): void {
	if (state.invalid) return;
	if (state.header === null) {
		state.header = headerOf(entry);
		if (state.header === null) state.invalid = true;
		return;
	}
	if (!isRecord(entry)) return;
	state.counts.entries += 1;
	foldTime(state, timeOf(entry.timestamp));
	const spend = spendOf(entry);
	if (spend) addSpend(state.spend, spend);
	switch (entry.type) {
		case "message":
			if (isRecord(entry.message)) foldMessage(state, entry.message, spend, range);
			return;
		case "compaction":
			state.counts.compactions += 1;
			return;
		case "model_change":
			state.counts.modelChanges += 1;
			return;
		case "session_info":
			state.title = text(entry.name)?.trim() || null;
			return;
		case "custom_message":
			if (entry.customType === SUBAGENT_COMPLETION_MESSAGE) foldRunDetails(state, entry.details);
			return;
		case "usage": {
			const childId = entry.kind === SUBAGENT_USAGE_KIND ? text(entry.note) : null;
			if (!childId || !spend) return;
			const ref = subagent(state, childId);
			ref.mirrored ??= emptySpend();
			addSpend(ref.mirrored, spend);
			return;
		}
	}
}

function isFileEntry(value: Record<string, unknown>): value is Record<string, unknown> & FileEntry {
	return typeof value.type === "string";
}

interface FoldResult {
	/** The state at `consumed`, resumable by an append; for a migrated file, the final state. */
	state: SummaryState;
	/** The state including a parseable unterminated last line. */
	final: SummaryState;
	appendable: boolean;
}

export class SummaryBuilder {
	private readonly state: SummaryState;
	private legacy: { entry: Record<string, unknown> & FileEntry; range: ByteRange }[] | null = null;

	constructor(resume?: SummaryState) {
		this.state = resume ? cloneState(resume) : emptyState();
	}

	add(entry: unknown, range: ByteRange): void {
		if (this.legacy) {
			if (isRecord(entry) && isFileEntry(entry)) this.legacy.push({ entry, range });
			return;
		}
		const fresh = this.state.header === null;
		foldEntry(this.state, entry, range);
		const header = this.state.header;
		if (fresh && header !== null && header.version < CURRENT_SESSION_VERSION && isRecord(entry))
			this.legacy = isFileEntry(entry) ? [{ entry, range }] : [];
	}

	finish(tail: ParsedLine | null): FoldResult {
		if (this.legacy) {
			if (tail && isRecord(tail.entry) && isFileEntry(tail.entry))
				this.legacy.push({ entry: tail.entry, range: tail.range });
			migrateSessionEntries(this.legacy.map(({ entry }) => entry));
			const state = emptyState();
			for (const { entry, range } of this.legacy) foldEntry(state, entry, range);
			return { state, final: state, appendable: false };
		}
		if (!tail) return { state: this.state, final: this.state, appendable: true };
		const final = cloneState(this.state);
		foldEntry(final, tail.entry, tail.range);
		return { state: this.state, final, appendable: true };
	}
}

function publicRefs(subagents: Record<string, SubagentState>): Record<string, SubagentRef> {
	const refs: Record<string, SubagentRef> = {};
	for (const [childId, { mirrored, reported, status }] of Object.entries(subagents))
		slot(refs, childId, () => ({ childId, mirrored, reported, status }));
	return refs;
}

export function toSummary(state: SummaryState, file: string): SessionSummary | null {
	const header = state.header;
	if (state.invalid || header === null) return null;
	return {
		sessionId: header.id,
		cwd: header.cwd,
		file,
		parentSession: header.parentSession,
		title: state.title,
		firstPrompt: state.firstPrompt,
		start: state.start ?? header.timestamp,
		end: state.end ?? header.timestamp,
		activeMs: state.activeMs,
		counts: state.counts,
		tools: state.tools,
		stopReasons: state.stopReasons,
		spend: state.spend,
		models: state.models,
		subagents: publicRefs(state.subagents),
	};
}

export function summarizeSessionText(file: string, text: string): SessionSummary | null {
	const builder = new SummaryBuilder();
	const { tail } = scanBytes(new TextEncoder().encode(text), (entry, range) =>
		builder.add(entry, range),
	);
	return toSummary(builder.finish(tail).final, file);
}
