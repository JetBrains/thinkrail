import {
	BACKGROUND_COMPLETION_MESSAGE,
	FAILED_RUN_STATUSES,
	FINDING_RULES,
	type MarkKind,
	type ResultVia,
	SUBAGENT_COMPLETION_MESSAGE,
	SUBAGENT_RESULT_TOOL,
	SUBAGENT_SPAWN_TOOL,
	type SubagentEvent,
	type ThinkingKind,
	type TimingOrigin,
	TODO_TOOLS,
	type TokenTotals,
	type ToolEvent,
	TRACE_LABEL_CHARS,
	type TraceEvent,
	type TraceMeta,
	type TurnTrigger,
	UNFINISHED_RUN_STATUSES,
	WAKE_DELIVERY,
	type WaitBand,
} from "./core.ts";
import {
	type CallFacts,
	callFacts,
	editLines,
	failureFacts,
	promptSkill,
	type ResultFacts,
	todoResult,
} from "./facts.ts";
import { type CallContext, ContextLedger, type EntryContext, entryContext } from "./ledger.ts";
import type { ByteRange } from "./lines.ts";
import { type WorkspacePaths, workspacePaths } from "./paths.ts";
import { isSecretName, labelOf, type Redactor, safeCut } from "./redact.ts";
import { type PromptSentence, promptSentences, promptWords } from "./repeats.ts";
import { recordsActivity } from "./summary.ts";
import { bashHead, toolFamily } from "./toolFamily.ts";
import { addSpend, emptySpend, isRecord, type Spend, type SpendTotals, spendOf } from "./totals.ts";
import { idleGaps, waitBands } from "./waits.ts";

/** Approximated spans longer than this are outliers (a result written after a restart), drawn as points. */
export const APPROXIMATE_CAP_MS = 2 * 60 * 60 * 1000;

/**
 * A tool call that ran and succeeded: it has a recorded result and the result is no error. A call
 * without a result (`missing`, as pi persists a reply stopped before its calls ran) neither succeeded
 * nor failed: it never ran.
 */
export function succeeded(event: ToolEvent): boolean {
	return event.missing !== true && event.error !== true;
}
const REQUEST_START_MIN_MS = 50;
const REQUEST_START_MAX_MS = 60 * 60 * 1000;
const EXIT_TAIL_CHARS = 300;
const SKILL_NAME_CHARS = 80;
/** Heuristic: a reply that says the tests (or checks) pass, in English or Russian. */
const PASS_CLAIM =
	/\b(?:all\s+)?(?:the\s+)?(?:unit\s+|e2e\s+)?(?:tests?|test suite|specs?|checks?)\s+(?:now\s+|all\s+|still\s+)?(?:pass(?:es|ed|ing)?\b|(?:are|is)\s+(?:passing|green)\b|green\b)|тест\S*\s+(?:теперь\s+|все\s+)?(?:проход|прошл|зел[её]н)/i;

export interface CallInfo {
	id: string;
	name: string;
	label: string;
	argsChars: number;
	head: string | null;
	role: string | null;
	task: string;
	/** An `Agent` task's paragraphs (redacted, cut), for a title without the session's shared preamble. */
	paragraphs: readonly string[];
	background: boolean;
	facts: CallFacts;
}

interface ChildInfo {
	childId: string;
	status: string | null;
	durationMs: number | null;
	tokens: number | null;
	cost: number | null;
	role: string | null;
	model: string | null;
}

export interface Failure {
	errorKey: string;
	errorLine: string;
}

/** Where a subagent's final result reached the parent. */
export interface Delivery {
	eventId: string;
	via: ResultVia;
	status: string | null;
	at: number;
}

/** The facts of a tool event's call and result. */
export interface ToolFacts {
	call: CallFacts | null;
	result: ResultFacts | null;
}

/** The provider and the requested model id, as the host's model catalog knows them. */
export interface CatalogModel {
	provider: string;
	id: string;
}

type EntryInfo =
	| {
			kind: "user";
			label: string;
			chars: number;
			skill: string | null;
			sentences: readonly PromptSentence[];
			words: readonly number[];
	  }
	| {
			kind: "assistant";
			model: string | null;
			catalog: CatalogModel | null;
			stop: string | null;
			tokens: TokenTotals;
			cost: number;
			requestedAt: number | null;
			durationMs: number | null;
			replyChars: number;
			label: string;
			thinking: ThinkingKind;
			calls: CallInfo[];
			failure: Failure | null;
			/** The reply says tests pass (a heuristic for "done without verification"). */
			claim: boolean;
	  }
	| {
			kind: "toolResult";
			toolCallId: string;
			toolName: string;
			isError: boolean;
			resultChars: number;
			createdAt: number | null;
			durationMs: number | null;
			exit: string | null;
			child: ChildInfo | null;
			facts: ResultFacts;
	  }
	| {
			kind: "mark";
			mark: MarkKind;
			label: string;
			detail: string | null;
			tokensBefore: number | null;
			child: ChildInfo | null;
			chars: number;
			/** A completion message's `details.delivery` (`wake` | `run` | `appended`). */
			delivery: string | null;
	  }
	| { kind: "skip" };

export interface EntryRecord {
	id: string;
	parentId: string | null;
	range: ByteRange;
	ts: number | null;
	info: EntryInfo;
	spend: Spend | null;
	context: EntryContext | null;
	/** A `usage` entry's `kind`. */
	usageKind?: string | null;
	/** The entry records a setting, not work (`recordsActivity`): it never extends the session's end. */
	setting?: true;
	/** The skills a persisted system prompt lists (its `skills` section, or a compaction's checkpoint). */
	skills?: readonly SkillListing[];
}

/** A skill in a persisted `<available_skills>` list and the characters its entry takes. */
export interface SkillListing {
	name: string;
	chars: number;
}

/** What a spend-bearing entry was: a model call, pi's mirror of subagent spend, a summary, or other usage. */
export type SpendSource = "model" | "subagent" | "summary" | "other";

export interface EventSource {
	entryId: string;
	range: ByteRange;
	callIndex?: number;
	toolCallId?: string;
	result?: { entryId: string; range: ByteRange };
}

/** For full-text search: the events an entry's text belongs to. */
export interface EntryRef {
	event: string;
	calls?: readonly string[];
}

/** A spend-bearing entry, on any branch. */
export interface SpendMark {
	t: number;
	spend: Spend;
	source: SpendSource;
	/** A model call's model (`provider/model`). */
	model: string | null;
	/** A model call that stopped with `error` or `aborted`. */
	error: boolean;
}

export interface BuiltTrace {
	sessionId: string;
	file: string;
	/** The session header's working folder. */
	cwd: string | null;
	events: readonly TraceEvent[];
	meta: TraceMeta;
	sources: ReadonlyMap<string, EventSource>;
	entries: ReadonlyMap<string, EntryRef>;
	/** Who the session waited on over `meta.start..meta.end`. */
	bands: readonly WaitBand[];
	/** Every spend-bearing entry of the file in file order, off-branch ones included. */
	spends: readonly SpendMark[];
	/** Recorded spend of the active-branch entries inside each turn, by turn event id. */
	turnSpend: ReadonlyMap<string, SpendTotals>;
	/** The catalog model behind each `LlmEvent.model`. */
	models: ReadonlyMap<string, CatalogModel>;
	/** Each tool event's call and result facts. */
	facts: ReadonlyMap<string, ToolFacts>;
	/** Each failed model call's error line and cluster key. */
	llmFailures: ReadonlyMap<string, Failure>;
	/** Turns whose prompt invoked a skill (`/skill:name`). */
	promptSkills: readonly { eventId: string; name: string; t: number }[];
	/** Each subagent's first final result in the parent, by child id. */
	deliveries: ReadonlyMap<string, Delivery>;
	/** The model a subagent's reports name, by child id. */
	childModels: ReadonlyMap<string, string>;
	/** Each model call's estimated request by category and what changed since the previous call. */
	contexts: ReadonlyMap<string, CallContext>;
	/** Recorded spend of compaction and branch summaries, every branch. */
	summarySpend: SpendTotals;
	/** Each persisted skills list of the file (any branch), in file order. */
	skillLists: readonly { entryId: string; t: number; skills: readonly SkillListing[] }[];
	/** Model calls whose reply says tests pass. */
	claims: ReadonlySet<string>;
	/** Each prompt's sentences, hashed, by turn event id. */
	prompts: readonly { eventId: string; t: number; sentences: readonly PromptSentence[] }[];
	/** Each prompt's words (three letters or more), hashed, by turn event id. */
	promptWords: ReadonlyMap<string, readonly number[]>;
}

function text(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

/** A name the model or a tool wrote (a subagent's role), masked like any label. */
function maskedName(value: unknown, redactor: Redactor): string | null {
	return typeof value === "string" ? redactor.clean(value) : null;
}

function finite(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function count(value: unknown): number {
	return finite(value) ?? 0;
}

function timeOf(value: unknown): number | null {
	if (typeof value !== "string") return null;
	const time = Date.parse(value);
	return Number.isFinite(time) ? time : null;
}

export function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((block) =>
			isRecord(block) && block.type === "text" && typeof block.text === "string"
				? [block.text]
				: [],
		)
		.join("\n");
}

function contentChars(content: unknown): number {
	if (typeof content === "string") return content.length;
	if (!Array.isArray(content)) return 0;
	let chars = 0;
	for (const block of content)
		if (isRecord(block) && typeof block.text === "string") chars += block.text.length;
	return chars;
}

function serializedChars(value: unknown): number {
	try {
		return JSON.stringify(value ?? {}).length;
	} catch {
		return 0;
	}
}

/** The first non-blank string argument whose name is not secret-named (`isSecretName`). */
function firstStringArg(args: Record<string, unknown>): string {
	for (const [key, value] of Object.entries(args))
		if (typeof value === "string" && value.trim() && !isSecretName(key)) return value;
	return "";
}

/**
 * A call's main argument as its label shows it: the command, the path, the pattern, else the first
 * top-level string argument that is not secret-named — never a value under a secret-named key.
 */
export function argumentLabel(name: string, args: Record<string, unknown>): string {
	const pick = (...keys: string[]) => {
		for (const key of keys) {
			const value = args[key];
			if (typeof value === "string" && value.trim()) return value;
		}
		return null;
	};
	switch (name) {
		case "bash":
		case "background_command":
			return pick("command") ?? firstStringArg(args);
		case "read":
		case "edit":
		case "write":
		case "ls":
			return pick("path", "file_path") ?? firstStringArg(args);
		case "grep":
		case "find": {
			const pattern = pick("pattern", "query") ?? "";
			const path = pick("path");
			return path ? `${pattern} ${path}` : pattern;
		}
		default:
			return pick("query", "url", "path", "title", "text", "command") ?? firstStringArg(args);
	}
}

/**
 * A call's trace label: its `argumentLabel` masked, then cut; a spawn's is its role and the first line of
 * its task, masked on its own before that line is kept.
 */
export function callLabel(redactor: Redactor, name: string, args: Record<string, unknown>): string {
	if (name !== SUBAGENT_SPAWN_TOOL)
		return redactor.label(argumentLabel(name, args), TRACE_LABEL_CHARS);
	const task = redactor.label(text(args.task) ?? "", TRACE_LABEL_CHARS, true);
	const role = text(args.subagent_type)?.trim() ? text(args.subagent_type) : null;
	return redactor.label(role ? `${role}: ${task}` : task, TRACE_LABEL_CHARS);
}

function exitOf(resultText: string, isError: boolean): string {
	const tail = resultText.slice(-EXIT_TAIL_CHARS);
	const match = /Command exited with code (\d+)|Command (timed out|aborted)/.exec(tail);
	if (match?.[1]) return match[1];
	if (match?.[2]) return match[2] === "timed out" ? "timeout" : "aborted";
	return isError ? "error" : "0";
}

function childInfo(details: unknown, redactor: Redactor): ChildInfo | null {
	if (!isRecord(details)) return null;
	const childId = text(details.childSessionId);
	if (!childId) return null;
	const usage = isRecord(details.usage) ? details.usage : null;
	const tokens = usage
		? count(usage.input) + count(usage.output) + count(usage.cacheRead) + count(usage.cacheWrite)
		: null;
	return {
		childId,
		status: text(details.status),
		durationMs: finite(details.durationMs),
		tokens,
		cost: usage ? finite(usage.cost) : null,
		role: maskedName(details.roleName, redactor),
		model: text(details.model),
	};
}

const PARAGRAPHS = 24;
const PARAGRAPH_CHARS = 400;

/** A task's first paragraphs, each cut to `PARAGRAPH_CHARS`, all cut from the masked task. */
export function taskParagraphs(task: string, redactor: Redactor): string[] {
	const masked = redactor.around(task, 0, PARAGRAPHS * PARAGRAPH_CHARS * 4).text;
	return masked
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean)
		.slice(0, PARAGRAPHS)
		.map((paragraph) => paragraph.slice(0, safeCut(paragraph, PARAGRAPH_CHARS)));
}

function thinkingOf(content: unknown[]): ThinkingKind {
	let kind: ThinkingKind = "none";
	for (const block of content) {
		if (!isRecord(block) || block.type !== "thinking") continue;
		if (typeof block.thinking === "string" && block.thinking.trim()) return "plain";
		if (block.redacted === true || typeof block.thinkingSignature === "string") kind = "encrypted";
	}
	return kind;
}

function assistantInfo(
	message: Record<string, unknown>,
	redactor: Redactor,
	paths: WorkspacePaths,
): EntryInfo {
	const content = Array.isArray(message.content) ? message.content : [];
	const usage = isRecord(message.usage) ? message.usage : {};
	const tokens = {
		input: count(usage.input),
		output: count(usage.output),
		cacheRead: count(usage.cacheRead),
		cacheWrite: count(usage.cacheWrite),
		total: 0,
	};
	tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
	const reply = contentText(content);
	const calls: CallInfo[] = [];
	for (const block of content) {
		if (!isRecord(block) || block.type !== "toolCall") continue;
		const name = text(block.name) ?? "";
		const args = isRecord(block.arguments) ? block.arguments : {};
		const task = name === SUBAGENT_SPAWN_TOOL ? (text(args.task) ?? "") : "";
		const shell = name === "bash" || name === "background_command";
		const command =
			shell && text(args.command)?.trim() ? redactor.around(String(args.command), 0, 0).text : null;
		calls.push({
			id: text(block.id) ?? `#${calls.length}`,
			name,
			label:
				command === null ? callLabel(redactor, name, args) : labelOf(command, TRACE_LABEL_CHARS),
			argsChars: serializedChars(block.arguments),
			head: shell ? bashHead(command) : null,
			role: maskedName(args.subagent_type, redactor),
			task: task ? redactor.label(task, TRACE_LABEL_CHARS) : "",
			paragraphs: task ? taskParagraphs(task, redactor) : [],
			background: args.run_in_background === true,
			facts: callFacts(name, block.arguments, redactor, paths),
		});
	}
	const provider = text(message.provider);
	const requested = text(message.model);
	const model = text(message.responseModel) ?? requested;
	const error = text(message.errorMessage);
	const stop = text(message.stopReason);
	return {
		kind: "assistant",
		claim: PASS_CLAIM.test(reply),
		model: provider && model ? `${provider}/${model}` : model,
		catalog: provider && requested ? { provider, id: requested } : null,
		stop: text(message.stopReason),
		tokens,
		cost: isRecord(usage.cost) ? count(usage.cost.total) : 0,
		requestedAt: finite(message.timestamp),
		durationMs: finite(message.durationMs),
		replyChars: reply.length,
		label:
			redactor.label(reply, TRACE_LABEL_CHARS, true) ||
			(error ? redactor.label(error, TRACE_LABEL_CHARS, true) : ""),
		thinking: thinkingOf(content),
		calls,
		failure:
			stop === "error" || stop === "aborted"
				? failureFacts("model", error ?? stop, redactor)
				: null,
	};
}

function toolResultInfo(message: Record<string, unknown>, redactor: Redactor): EntryInfo {
	const name = text(message.toolName) ?? "";
	const isError = message.isError === true;
	const resultText = contentText(message.content);
	const failure = isError ? failureFacts(name, resultText, redactor) : null;
	return {
		kind: "toolResult",
		toolCallId: text(message.toolCallId) ?? "",
		toolName: name,
		isError,
		resultChars: contentChars(message.content),
		createdAt: finite(message.timestamp),
		durationMs: finite(message.durationMs),
		exit: name === "bash" || name === "background_command" ? exitOf(resultText, isError) : null,
		child:
			name === SUBAGENT_SPAWN_TOOL || name === SUBAGENT_RESULT_TOOL
				? childInfo(message.details, redactor)
				: null,
		facts: {
			errorKey: failure?.errorKey ?? null,
			errorLine: failure?.errorLine ?? null,
			todo:
				!isError && (TODO_TOOLS as readonly string[]).includes(name)
					? todoResult(name, message.details, resultText, redactor)
					: null,
			edit: !isError && name === "edit" ? editLines(message.details) : null,
		},
	};
}

function mark(
	kind: MarkKind,
	label: string,
	detail: string | null = null,
	extra: {
		tokensBefore?: number | null;
		child?: ChildInfo | null;
		chars?: number;
		delivery?: string | null;
	} = {},
): EntryInfo {
	return {
		kind: "mark",
		mark: kind,
		label,
		detail,
		tokensBefore: extra.tokensBefore ?? null,
		child: extra.child ?? null,
		chars: extra.chars ?? 0,
		delivery: extra.delivery ?? null,
	};
}

function messageInfo(
	message: Record<string, unknown>,
	redactor: Redactor,
	paths: WorkspacePaths,
): EntryInfo {
	switch (message.role) {
		case "user": {
			const prompt = contentText(message.content);
			const skill = promptSkill(prompt, redactor);
			return {
				kind: "user",
				label: redactor.label(prompt, TRACE_LABEL_CHARS),
				chars: contentChars(message.content),
				skill,
				sentences: skill ? [] : promptSentences(prompt, redactor, FINDING_RULES.repeatWords),
				words: promptWords(prompt),
			};
		}
		case "assistant":
			return assistantInfo(message, redactor, paths);
		case "toolResult":
			return toolResultInfo(message, redactor);
		case "system":
			return mark("system", "");
		case "custom":
		case "hookMessage": {
			const customType = text(message.customType);
			return mark(
				"customMessage",
				redactor.label(contentText(message.content), TRACE_LABEL_CHARS),
				customType,
			);
		}
		case "bashExecution":
			return mark(
				"customMessage",
				redactor.label(text(message.command) ?? "", TRACE_LABEL_CHARS),
				"bashExecution",
			);
		default:
			return { kind: "skip" };
	}
}

function entryInfo(
	entry: Record<string, unknown>,
	redactor: Redactor,
	paths: WorkspacePaths,
): EntryInfo {
	switch (entry.type) {
		case "message":
			return isRecord(entry.message)
				? messageInfo(entry.message, redactor, paths)
				: { kind: "skip" };
		case "custom_message": {
			const customType = text(entry.customType);
			const completion =
				customType === SUBAGENT_COMPLETION_MESSAGE || customType === BACKGROUND_COMPLETION_MESSAGE;
			return mark(
				"customMessage",
				redactor.label(contentText(entry.content), TRACE_LABEL_CHARS),
				customType,
				{
					child:
						customType === SUBAGENT_COMPLETION_MESSAGE ? childInfo(entry.details, redactor) : null,
					chars: contentChars(entry.content),
					delivery: completion && isRecord(entry.details) ? text(entry.details.delivery) : null,
				},
			);
		}
		case "compaction":
			return mark(
				"compaction",
				redactor.label(text(entry.summary) ?? "", TRACE_LABEL_CHARS),
				null,
				{
					tokensBefore: finite(entry.tokensBefore),
				},
			);
		case "model_change": {
			const provider = text(entry.provider);
			const model = text(entry.modelId);
			return mark("modelChange", "", provider && model ? `${provider}/${model}` : model);
		}
		case "thinking_level_change":
			return mark("thinkingLevel", "", text(entry.thinkingLevel));
		case "session_info":
			return mark("sessionInfo", redactor.label(text(entry.name) ?? "", TRACE_LABEL_CHARS));
		case "label":
			return mark("label", redactor.label(text(entry.label) ?? "", TRACE_LABEL_CHARS));
		case "branch_summary":
			return mark("branchSummary", redactor.label(text(entry.summary) ?? "", TRACE_LABEL_CHARS));
		default:
			return { kind: "skip" };
	}
}

function unescapeXml(value: string): string {
	return value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

/** The skills a persisted `skills` section lists (pi's `<available_skills>` entries), with their sizes. */
export function skillListing(section: string, redactor: Redactor): SkillListing[] {
	const out: SkillListing[] = [];
	const seen = new Set<string>();
	for (const match of section.matchAll(/<skill>([\s\S]*?)<\/skill>/g)) {
		const name = /<name>([\s\S]*?)<\/name>/.exec(match[1] ?? "")?.[1]?.trim();
		if (!name) continue;
		const label = redactor.label(unescapeXml(name), SKILL_NAME_CHARS);
		if (seen.has(label)) continue;
		seen.add(label);
		out.push({ name: label, chars: match[0].length + 1 });
	}
	return out;
}

function systemSkills(
	entry: Record<string, unknown>,
	redactor: Redactor,
): readonly SkillListing[] | undefined {
	const system =
		entry.type === "message" && isRecord(entry.message) && entry.message.role === "system"
			? entry.message
			: entry.type === "compaction" && isRecord(entry.systemMessage)
				? entry.systemMessage
				: null;
	if (!system || !isRecord(system.sections) || !Object.hasOwn(system.sections, "skills"))
		return undefined;
	const section = system.sections.skills;
	return typeof section === "string" ? skillListing(section, redactor) : [];
}

export interface Collected {
	sessionId: string;
	start: number | null;
	cwd?: string | null;
	records: readonly EntryRecord[];
}

/** Collects the light per-entry records a trace is built from; message bodies are dropped here. */
export class EntryCollector {
	private readonly redactor: Redactor;
	private readonly records: EntryRecord[] = [];
	private header: {
		id: string;
		timestamp: number | null;
		cwd: string | null;
		paths: WorkspacePaths;
	} | null = null;
	private invalid = false;

	constructor(redactor: Redactor) {
		this.redactor = redactor;
	}

	add(entry: unknown, range: ByteRange): void {
		if (this.invalid) return;
		if (this.header === null) {
			if (isRecord(entry) && entry.type === "session" && typeof entry.id === "string")
				this.header = {
					id: entry.id,
					timestamp: timeOf(entry.timestamp),
					cwd: text(entry.cwd),
					paths: workspacePaths(text(entry.cwd)),
				};
			else this.invalid = true;
			return;
		}
		if (!isRecord(entry) || typeof entry.type !== "string") return;
		const ownId = text(entry.id);
		const record: EntryRecord = {
			id: ownId ?? `@${range.offset}`,
			parentId: ownId === null ? (this.records.at(-1)?.id ?? null) : text(entry.parentId),
			range,
			ts: timeOf(entry.timestamp),
			info: entryInfo(entry, this.redactor, this.header.paths),
			spend: spendOf(entry),
			context: entryContext(entry),
		};
		if (entry.type === "usage") record.usageKind = text(entry.kind);
		if (!recordsActivity(entry)) record.setting = true;
		const skills = systemSkills(entry, this.redactor);
		if (skills) record.skills = skills;
		this.records.push(record);
	}

	result(): Collected | null {
		if (this.invalid || this.header === null) return null;
		return {
			sessionId: this.header.id,
			start: this.header.timestamp,
			cwd: this.header.cwd,
			records: this.records,
		};
	}
}

interface Node {
	event: TraceEvent;
	children: Node[];
	source: EventSource;
}

function activePath(records: readonly EntryRecord[]): Set<string> {
	const byId = new Map(records.map((record) => [record.id, record]));
	const path = new Set<string>();
	for (let record = records.at(-1); record && !path.has(record.id); ) {
		path.add(record.id);
		record = record.parentId === null ? undefined : byId.get(record.parentId);
	}
	return path;
}

function pointTiming(at: number): { t0: number; t1: number; timing: TimingOrigin } {
	return { t0: at, t1: at, timing: "notMeasured" };
}

export function buildTrace(file: string, revision: string, collected: Collected): BuiltTrace {
	const { records } = collected;
	const path = activePath(records);
	const roots: Node[] = [];
	const sources = new Map<string, EventSource>();
	const entries = new Map<string, EntryRef>();
	const toolsByCall = new Map<string, Node>();
	const subagents = new Map<string, Node>();
	const turnSpend = new Map<string, SpendTotals>();
	const models = new Map<string, CatalogModel>();
	const spends: SpendMark[] = [];
	const facts = new Map<string, ToolFacts>();
	const llmFailures = new Map<string, Failure>();
	const promptSkills: { eventId: string; name: string; t: number }[] = [];
	const deliveries = new Map<string, Delivery>();
	const deliveredAt = new Map<string, number>();
	const llmOrder: { seq: number; id: string }[] = [];
	const ledger = new ContextLedger();
	const contexts = new Map<string, CallContext>();
	const settings = new Set<string>();
	let seq = 0;
	let turn: Node | null = null;
	let turns = 0;
	let idle = true;
	let previousTs: number | null = collected.start;
	const attach = (node: Node, parent: Node | null) => {
		(parent ? parent.children : roots).push(node);
		sources.set(node.event.id, node.source);
	};
	const startTurn = (
		record: EntryRecord,
		ts: number,
		trigger: TurnTrigger,
		label: string,
		chars: number,
	): Node => {
		turns += 1;
		const node: Node = {
			event: {
				kind: "turn",
				id: record.id,
				parent: null,
				depth: 0,
				...pointTiming(ts),
				label,
				n: turns,
				trigger,
				chars,
			},
			children: [],
			source: { entryId: record.id, range: record.range },
		};
		attach(node, null);
		entries.set(record.id, { event: record.id });
		turnSpend.set(record.id, emptySpend());
		idle = false;
		return node;
	};
	const callTasks = new Map<string, CallInfo>();
	const childModels = new Map<string, string>();
	const updateChild = (
		child: ChildInfo,
		at: number | null,
		delivery: Omit<Delivery, "status" | "at"> | null = null,
	) => {
		const finished = child.status !== null && !UNFINISHED_RUN_STATUSES.includes(child.status);
		if (child.model && !childModels.has(child.childId)) childModels.set(child.childId, child.model);
		if (finished && delivery && !deliveries.has(child.childId)) {
			deliveries.set(child.childId, { ...delivery, status: child.status, at: at ?? 0 });
			deliveredAt.set(child.childId, seq);
		}
		const node = subagents.get(child.childId);
		if (node?.event.kind !== "subagent") return;
		const event = node.event;
		const settled = event.status !== null && !UNFINISHED_RUN_STATUSES.includes(event.status);
		if (child.status !== null && (finished || !settled)) event.status = child.status;
		if (finished && child.tokens !== null) {
			event.tokens = child.tokens;
			event.cost = child.cost;
		}
		if (finished && at !== null && at > event.t1) {
			event.t1 = at;
			if (event.timing === "notMeasured") event.timing = "approximated";
		}
		if (FAILED_RUN_STATUSES.includes(event.status ?? "")) event.error = true;
		else delete event.error;
	};

	let fileTs: number | null = collected.start;
	const summarySpend = emptySpend();
	const skillLists: { entryId: string; t: number; skills: readonly SkillListing[] }[] = [];
	for (const record of records) {
		fileTs = record.ts ?? fileTs;
		if (record.skills)
			skillLists.push({ entryId: record.id, t: fileTs ?? 0, skills: record.skills });
		if (!record.spend) continue;
		const info = record.info;
		const summary =
			info.kind === "mark" && (info.mark === "compaction" || info.mark === "branchSummary");
		if (summary) addSpend(summarySpend, record.spend);
		spends.push({
			t: fileTs ?? 0,
			spend: record.spend,
			source:
				info.kind === "assistant"
					? "model"
					: record.usageKind === "subagent"
						? "subagent"
						: summary
							? "summary"
							: "other",
			model: info.kind === "assistant" ? info.model : null,
			error: info.kind === "assistant" && (info.stop === "error" || info.stop === "aborted"),
		});
	}
	const claims = new Set<string>();
	const prompts: { eventId: string; t: number; sentences: readonly PromptSentence[] }[] = [];
	const promptWordSets = new Map<string, readonly number[]>();

	for (const record of records) {
		if (!path.has(record.id)) continue;
		seq += 1;
		const ts = record.ts ?? previousTs ?? 0;
		const info = record.info;
		const parent: Node | null = turn;
		if (info.kind === "assistant")
			contexts.set(record.id, {
				estimate: ledger.snapshot(),
				system: ledger.hasSystem(),
				changes: ledger.take(),
			});
		else if (info.kind === "mark" && info.mark === "modelChange") ledger.noteModel(info.detail);
		else if (info.kind === "mark" && info.mark === "thinkingLevel") ledger.noteThinkingLevel();
		ledger.apply(record.id, record.context);
		switch (info.kind) {
			case "user":
				turn = startTurn(record, ts, "prompt", info.label, info.chars);
				if (info.skill) promptSkills.push({ eventId: record.id, name: info.skill, t: ts });
				if (info.sentences.length > 0)
					prompts.push({ eventId: record.id, t: ts, sentences: info.sentences });
				if (info.words.length > 0) promptWordSets.set(record.id, info.words);
				break;
			case "assistant": {
				idle = info.stop !== "toolUse";
				if (info.model && info.catalog && !models.has(info.model))
					models.set(info.model, info.catalog);
				let t0 = ts;
				let t1 = ts;
				let timing: TimingOrigin = "notMeasured";
				if (info.durationMs !== null) {
					t0 = info.requestedAt ?? ts - info.durationMs;
					t1 = t0 + info.durationMs;
					timing = "recorded";
				} else if (
					info.requestedAt !== null &&
					ts - info.requestedAt > REQUEST_START_MIN_MS &&
					ts - info.requestedAt < REQUEST_START_MAX_MS
				) {
					t0 = info.requestedAt;
					timing = "approximated";
				} else if (
					previousTs !== null &&
					ts - previousTs > 0 &&
					ts - previousTs <= APPROXIMATE_CAP_MS
				) {
					t0 = previousTs;
					timing = "approximated";
				}
				const node: Node = {
					event: {
						kind: "llm",
						id: record.id,
						parent: parent?.event.id ?? null,
						depth: 0,
						t0,
						t1,
						timing,
						label: info.label,
						model: info.model,
						stop: info.stop,
						tokens: info.tokens,
						cost: info.cost,
						replyChars: info.replyChars,
						thinking: info.thinking,
						calls: info.calls.length,
						...(info.stop === "error" || info.stop === "aborted" ? { error: true as const } : {}),
					},
					children: [],
					source: { entryId: record.id, range: record.range },
				};
				attach(node, parent);
				llmOrder.push({ seq, id: record.id });
				if (info.claim) claims.add(record.id);
				if (info.failure) llmFailures.set(record.id, info.failure);
				const callIds: string[] = [];
				info.calls.forEach((call, callIndex) => {
					const id = `tool:${record.id}:${callIndex}`;
					callIds.push(id);
					const tool: Node = {
						event: {
							kind: "tool",
							id,
							parent: record.id,
							depth: 0,
							...pointTiming(t1),
							label: call.label,
							tool: call.name,
							family: toolFamily(call.name, call.head),
							toolCallId: call.id,
							argsChars: call.argsChars,
							resultChars: null,
							missing: true,
							...(call.head ? { head: call.head } : {}),
						},
						children: [],
						source: { entryId: record.id, range: record.range, callIndex, toolCallId: call.id },
					};
					attach(tool, node);
					facts.set(id, { call: call.facts, result: null });
					if (!toolsByCall.has(call.id)) toolsByCall.set(call.id, tool);
					if (call.name === SUBAGENT_SPAWN_TOOL) callTasks.set(call.id, call);
				});
				entries.set(record.id, { event: record.id, calls: callIds });
				break;
			}
			case "toolResult": {
				let node = toolsByCall.get(info.toolCallId);
				toolsByCall.delete(info.toolCallId);
				if (!node) {
					const id = `tool:${record.id}`;
					node = {
						event: {
							kind: "tool",
							id,
							parent: parent?.event.id ?? null,
							depth: 0,
							...pointTiming(ts),
							label: "",
							tool: info.toolName,
							family: toolFamily(info.toolName, null),
							toolCallId: info.toolCallId,
							argsChars: 0,
							resultChars: null,
						},
						children: [],
						source: { entryId: record.id, range: record.range, toolCallId: info.toolCallId },
					};
					attach(node, parent);
				}
				const event = node.event;
				if (event.kind !== "tool") break;
				const issuedAt = event.t0;
				const resultAt = info.createdAt ?? ts;
				if (info.durationMs !== null) {
					event.t1 = resultAt;
					event.t0 = resultAt - info.durationMs;
					event.timing = "recorded";
				} else if (resultAt - issuedAt >= 0 && resultAt - issuedAt <= APPROXIMATE_CAP_MS) {
					event.t1 = resultAt;
					event.timing = resultAt > issuedAt ? "approximated" : "notMeasured";
				}
				event.resultChars = info.resultChars;
				facts.set(event.id, { call: facts.get(event.id)?.call ?? null, result: info.facts });
				delete event.missing;
				if (info.isError) event.error = true;
				if (info.exit !== null) event.exit = info.exit;
				node.source.result = { entryId: record.id, range: record.range };
				entries.set(record.id, { event: event.id });
				const child = info.child;
				if (child && info.toolName === SUBAGENT_SPAWN_TOOL && !subagents.has(child.childId)) {
					const call = callTasks.get(info.toolCallId);
					const end =
						child.durationMs !== null && !call?.background
							? Math.max(event.t1, event.t0 + child.durationMs)
							: event.t1;
					const subagent: Node = {
						event: {
							kind: "subagent",
							id: `sub:${child.childId}`,
							parent: event.id,
							depth: 0,
							t0: event.t0,
							t1: end,
							timing: event.timing,
							label: call?.task ?? "",
							childId: child.childId,
							role: call?.role ?? child.role,
							status: child.status,
							tokens: null,
							cost: null,
							...(call?.background ? { background: true as const } : {}),
						},
						children: [],
						source: node.source,
					};
					attach(subagent, node);
					subagents.set(child.childId, subagent);
					updateChild(child, resultAt, { eventId: event.id, via: SUBAGENT_SPAWN_TOOL });
				} else if (child)
					updateChild(child, resultAt, {
						eventId: event.id,
						via: info.toolName === SUBAGENT_SPAWN_TOOL ? SUBAGENT_SPAWN_TOOL : SUBAGENT_RESULT_TOOL,
					});
				break;
			}
			case "mark": {
				const completion =
					info.detail === BACKGROUND_COMPLETION_MESSAGE ||
					info.detail === SUBAGENT_COMPLETION_MESSAGE;
				if (completion && (info.delivery === WAKE_DELIVERY || (info.delivery === null && idle))) {
					const trigger = info.detail === SUBAGENT_COMPLETION_MESSAGE ? "subagent" : "background";
					turn = startTurn(record, ts, trigger, info.label, info.chars);
					if (info.child) updateChild(info.child, ts, { eventId: record.id, via: "completion" });
					break;
				}
				const node: Node = {
					event: {
						kind: "mark",
						id: record.id,
						parent: parent?.event.id ?? null,
						depth: 0,
						...pointTiming(ts),
						label: info.label,
						mark: info.mark,
						detail: info.detail,
						...(info.tokensBefore !== null ? { tokensBefore: info.tokensBefore } : {}),
					},
					children: [],
					source: { entryId: record.id, range: record.range },
				};
				attach(node, parent);
				entries.set(record.id, { event: record.id });
				if (record.setting) settings.add(record.id);
				if (info.child) updateChild(info.child, ts, { eventId: record.id, via: "completion" });
				break;
			}
			case "skip":
				break;
		}
		const owner = turn?.event.id;
		const spent = owner ? turnSpend.get(owner) : undefined;
		if (spent && record.spend) addSpend(spent, record.spend);
		previousTs = ts;
	}

	const events: TraceEvent[] = [];
	const visit = (node: Node, parent: TraceEvent | null, depth: number): number => {
		const event = node.event;
		event.parent = parent?.id ?? null;
		event.depth = depth;
		events.push(event);
		let end = event.kind === "mark" ? Number.NEGATIVE_INFINITY : event.t1;
		for (const child of node.children) end = Math.max(end, visit(child, event, depth + 1));
		if (event.kind === "turn") event.t1 = Math.max(event.t0, end);
		return end;
	};
	for (const node of roots) visit(node, null, 0);

	const titled = events.filter((event): event is SubagentEvent => event.kind === "subagent");
	const titles = taskTitles(
		titled.map((event) => {
			const toolCallId = sources.get(event.id)?.toolCallId;
			return toolCallId ? (callTasks.get(toolCallId)?.paragraphs ?? []) : [];
		}),
	);
	titled.forEach((event, at) => {
		const title = titles[at];
		if (title) event.label = title;
		const delivered = deliveredAt.get(event.childId);
		const consumer =
			delivered === undefined ? undefined : llmOrder.find((call) => call.seq > delivered);
		if (consumer) event.consumedBy = consumer.id;
	});

	let start: number | null = null;
	let end: number | null = null;
	let errors = 0;
	for (const event of events) {
		start = start === null ? event.t0 : Math.min(start, event.t0);
		if (!settings.has(event.id)) end = end === null ? event.t1 : Math.max(end, event.t1);
		if (event.error && (event.kind === "tool" || event.kind === "llm")) errors += 1;
	}
	end ??= start;
	const bands = start !== null && end !== null ? waitBands(events, start, end) : [];
	const meta: TraceMeta = {
		revision,
		total: events.length,
		start,
		end,
		errors,
		gaps: idleGaps(bands),
		offBranch: records.length - path.size,
	};
	return {
		sessionId: collected.sessionId,
		file,
		cwd: collected.cwd ?? null,
		events,
		meta,
		sources,
		entries,
		bands,
		spends,
		turnSpend,
		models,
		facts,
		llmFailures,
		promptSkills,
		deliveries,
		childModels,
		contexts,
		summarySpend,
		skillLists,
		claims,
		prompts,
		promptWords: promptWordSets,
	};
}

const TITLE_KEY_CHARS = 48;
const TITLE_SHORT_CHARS = 26;

function titleKey(paragraph: string): string {
	return paragraph.toLowerCase().replace(/\s+/g, " ").slice(0, TITLE_KEY_CHARS);
}

function wordCount(paragraph: string): number {
	return (paragraph.match(/[\p{L}\p{N}_#./-]+/gu) ?? []).length;
}

/**
 * Each task's title: its first paragraph of three words or more whose opening no other task of the
 * session shares, so a common preamble is skipped and the specific ask names the run.
 */
export function taskTitles(tasks: readonly (readonly string[])[]): string[] {
	const counts = new Map<string, number>();
	for (const paragraphs of tasks)
		for (const key of new Set(paragraphs.map(titleKey)))
			counts.set(key, (counts.get(key) ?? 0) + 1);
	return tasks.map((paragraphs) => {
		const pick =
			paragraphs.find(
				(paragraph) => (counts.get(titleKey(paragraph)) ?? 0) <= 1 && wordCount(paragraph) >= 3,
			) ??
			paragraphs.find((paragraph) => wordCount(paragraph) >= 3) ??
			paragraphs[0] ??
			"";
		const lines = pick
			.split("\n")
			.map((line) => line.trim().replace(/^[#>*\-\s]+/, ""))
			.filter(Boolean);
		let title = lines[0] ?? "";
		if ((title.length < TITLE_SHORT_CHARS || title.endsWith(":")) && lines[1])
			title += ` ${lines[1].replace(/^\d+[.)]\s*/, "")}`;
		const flat = title.replace(/\s+/g, " ").trim();
		return flat.length > TRACE_LABEL_CHARS
			? `${flat.slice(0, safeCut(flat, TRACE_LABEL_CHARS - 1))}…`
			: flat;
	});
}
