import { buildSessionProjection, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { countedCalls } from "./context.ts";
import type {
	DiffSegment,
	FirstDifference,
	LlmEvent,
	MissCheck,
	RequestDiff,
	RequestDiffParams,
	RequestMessage,
	RequestRole,
	RequestSide,
	SectionDiff,
	ToolSetDiff,
} from "./core.ts";
import { CACHE_TTL_MS } from "./core.ts";
import { scanFile, sliceYielder } from "./lines.ts";
import { parseSessionParams } from "./list.ts";
import { turnsOf } from "./plan.ts";
import { type Redactor, safeCut, safeStart } from "./redact.ts";
import { contextOf } from "./timeline.ts";
import { isRecord } from "./totals.ts";
import type { BuiltTrace } from "./trace.ts";
import type { TraceStore } from "./traceStore.ts";

const CALL_ID_MAX = 400;
const LABEL_CHARS = 140;
const EDGE_MESSAGES = 3;
const MAX_LISTED = 160;
const MAX_REMOVED = 40;
const DIFF_CONTEXT = 160;
const DIFF_CHARS = 1_200;
const SLICE_MS = 8;

export function parseRequestDiffParams(value: unknown): RequestDiffParams {
	const method = "request.diff";
	const { sessionId } = parseSessionParams(value, method);
	const callId = isRecord(value) ? value.callId : undefined;
	if (typeof callId !== "string" || callId.length === 0 || callId.length > CALL_ID_MAX)
		throw new Error(`Invalid ${method} params`);
	return { sessionId, callId };
}

interface SystemState {
	sections: Map<string, string>;
	content: string;
	tools: Map<string, string>;
}

interface Listed {
	key: string;
	entryId: string;
	role: RequestRole;
	message: Record<string, unknown>;
	signature: string;
}

interface Request {
	system: SystemState;
	messages: Listed[];
}

function textOf(content: unknown): string {
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

function serialize(value: unknown): string {
	try {
		return JSON.stringify(value ?? null) ?? "";
	} catch {
		return "";
	}
}

function fnv(text: string): string {
	let hash = 0x811c9dc5;
	for (let at = 0; at < text.length; at++) {
		hash ^= text.charCodeAt(at);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

const ROLES: ReadonlySet<string> = new Set([
	"user",
	"assistant",
	"toolResult",
	"custom",
	"bashExecution",
	"compactionSummary",
	"branchSummary",
]);

/** Replays system messages as pi does: content appended, sections patched by name, tools by name. */
function replaySystem(messages: readonly Record<string, unknown>[]): SystemState {
	const state: SystemState = { sections: new Map(), content: "", tools: new Map() };
	const content: string[] = [];
	for (const message of messages) {
		if (message.role !== "system") continue;
		const text = textOf(message.content);
		if (text) content.push(text);
		if (isRecord(message.sections))
			for (const [name, value] of Object.entries(message.sections)) {
				if (typeof value === "string") state.sections.set(name, value);
				else state.sections.delete(name);
			}
		for (const tool of Array.isArray(message.toolsRemoved) ? message.toolsRemoved : [])
			if (isRecord(tool) && typeof tool.name === "string") state.tools.delete(tool.name);
		for (const tool of Array.isArray(message.toolsAdded) ? message.toolsAdded : [])
			if (isRecord(tool) && typeof tool.name === "string")
				state.tools.set(tool.name, serialize(tool));
	}
	state.content = content.join("\n\n");
	return state;
}

/** pi's model-visible request for the entry `leafId`, via its exported context projection. */
function requestAt(
	entries: SessionEntry[],
	byId: Map<string, SessionEntry>,
	leafId: string | null,
) {
	const projection = buildSessionProjection(entries, leafId, byId);
	const flat: Record<string, unknown>[] = [];
	const messages: Listed[] = [];
	for (const projected of projection.entries) {
		projected.messages.forEach((value, k) => {
			const message = value as unknown as Record<string, unknown>;
			flat.push(message);
			if (message.role === "system") return;
			const role =
				typeof message.role === "string" && ROLES.has(message.role) ? message.role : "other";
			messages.push({
				key: `${projected.sourceEntry.id}#${k}`,
				entryId: projected.sourceEntry.id,
				role: role as RequestRole,
				message,
				signature: fnv(serialize(message.content ?? message.summary ?? message.output ?? null)),
			});
		});
	}
	return { system: replaySystem(flat), messages } satisfies Request;
}

function messageChars(message: Record<string, unknown>): number {
	if (typeof message.summary === "string") return message.summary.length;
	if (message.role === "bashExecution")
		return (
			(typeof message.command === "string" ? message.command.length : 0) +
			(typeof message.output === "string" ? message.output.length : 0)
		);
	const content = message.content;
	if (typeof content === "string") return content.length;
	let chars = 0;
	for (const block of Array.isArray(content) ? content : []) {
		if (!isRecord(block)) continue;
		if (typeof block.text === "string") chars += block.text.length;
		else if (typeof block.thinking === "string") chars += block.thinking.length;
		else if (block.type === "toolCall")
			chars +=
				(typeof block.name === "string" ? block.name.length : 0) +
				serialize(block.arguments).length;
	}
	return chars;
}

function messageLabel(message: Record<string, unknown>, redactor: Redactor): string {
	const line = (text: string) => redactor.label(text, LABEL_CHARS);
	switch (message.role) {
		case "assistant": {
			const text = textOf(message.content);
			if (text.trim()) return line(text);
			const calls = (Array.isArray(message.content) ? message.content : []).flatMap((block) =>
				isRecord(block) && block.type === "toolCall" && typeof block.name === "string"
					? [block.name]
					: [],
			);
			return calls.length > 0 ? line(`→ ${calls.join(", ")}`) : "";
		}
		case "toolResult":
			return line(
				`${typeof message.toolName === "string" ? message.toolName : ""} · ${textOf(message.content)}`,
			);
		case "custom":
			return line(
				`${typeof message.customType === "string" ? message.customType : ""}: ${textOf(message.content)}`,
			);
		case "bashExecution":
			return line(typeof message.command === "string" ? message.command : "");
		case "compactionSummary":
		case "branchSummary":
			return line(typeof message.summary === "string" ? message.summary : "");
		default:
			return line(textOf(message.content));
	}
}

function capped(text: string): string {
	return text.length > DIFF_CHARS ? `${text.slice(0, safeCut(text, DIFF_CHARS))}…` : text;
}

/**
 * The changed middle of two texts with a little unchanged context on each side, cut. Both texts are
 * masked whole before they are compared, so a secret is masked with the context that names it
 * (`API_KEY=` before its value, a JSON key) and every segment is cut from masked text; a change that
 * lies only inside masked text shows no segment.
 */
export function changedSpan(before: string, after: string, redactor: Redactor): DiffSegment[] {
	const a = redactor.clean(before);
	const b = redactor.clean(after);
	if (a === b) return [];
	const shorter = Math.min(a.length, b.length);
	let start = 0;
	while (start < shorter && a[start] === b[start]) start += 1;
	start = Math.min(safeCut(a, start), safeCut(b, start));
	let end = 0;
	while (end < shorter - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;
	end = Math.min(a.length - safeStart(a, a.length - end), b.length - safeStart(b, b.length - end));
	const out: DiffSegment[] = [];
	if (start > 0) {
		const from = start > DIFF_CONTEXT ? safeStart(a, start - DIFF_CONTEXT) : 0;
		out.push({ op: "same", text: (from > 0 ? "…" : "") + a.slice(from, start) });
	}
	const removed = a.slice(start, a.length - end);
	if (removed) out.push({ op: "removed", text: capped(removed) });
	const added = b.slice(start, b.length - end);
	if (added) out.push({ op: "added", text: capped(added) });
	if (end > 0) {
		const from = b.length - end;
		const to = end > DIFF_CONTEXT ? safeCut(b, from + DIFF_CONTEXT) : b.length;
		out.push({ op: "same", text: b.slice(from, to) + (to < b.length ? "…" : "") });
	}
	return out;
}

function sectionDiffs(before: SystemState | null, after: SystemState, redactor: Redactor) {
	const names = [...(before?.sections.keys() ?? [])];
	for (const name of after.sections.keys()) if (!names.includes(name)) names.push(name);
	const content = (state: SystemState | null) => (state?.content ? state.content : null);
	const out: SectionDiff[] = [];
	const push = (name: string, a: string | null, b: string | null) => {
		const status: SectionDiff["status"] =
			a === null ? "added" : b === null ? "removed" : a === b ? "same" : "changed";
		out.push({
			name: redactor.redact(name),
			before: a?.length ?? null,
			after: b?.length ?? null,
			status,
			...(status === "changed" && a !== null && b !== null
				? { diff: changedSpan(a, b, redactor) }
				: {}),
		});
	};
	if (content(before) !== null || content(after) !== null)
		push("(content)", before ? content(before) : null, content(after));
	for (const name of names) {
		if (!before) {
			push(name, null, after.sections.get(name) ?? null);
			continue;
		}
		push(name, before.sections.get(name) ?? null, after.sections.get(name) ?? null);
	}
	return out;
}

function toolDiff(before: SystemState | null, after: SystemState): ToolSetDiff {
	const size = (state: SystemState | null) => {
		let chars = 0;
		for (const json of state?.tools.values() ?? []) chars += json.length;
		return { count: state?.tools.size ?? 0, chars };
	};
	const added: string[] = [];
	const removed: string[] = [];
	const changed: string[] = [];
	if (before) {
		for (const [name, json] of after.tools) {
			const previous = before.tools.get(name);
			if (previous === undefined) added.push(name);
			else if (previous !== json) changed.push(name);
		}
		for (const name of before.tools.keys()) if (!after.tools.has(name)) removed.push(name);
	}
	return { before: size(before), after: size(after), added, removed, changed };
}

function side(event: LlmEvent, n: number, turn: number | null, request: Request): RequestSide {
	let systemChars = request.system.content.length;
	for (const text of request.system.sections.values()) systemChars += text.length;
	return {
		callId: event.id,
		n,
		t: event.t0,
		model: event.model,
		turn,
		total: contextOf(event),
		input: event.tokens.input,
		cacheRead: event.tokens.cacheRead,
		cacheWrite: event.tokens.cacheWrite,
		messages: request.messages.length,
		systemChars,
	};
}

async function readEntries(file: string, end: number): Promise<SessionEntry[]> {
	const entries: SessionEntry[] = [];
	const { tail } = await scanFile(
		file,
		0,
		end,
		(entry) => {
			if (isRecord(entry) && typeof entry.type === "string" && entry.type !== "session")
				entries.push(entry as unknown as SessionEntry);
		},
		sliceYielder(SLICE_MS),
	);
	if (tail && isRecord(tail.entry) && tail.entry.type !== "session")
		entries.push(tail.entry as unknown as SessionEntry);
	return entries;
}

/**
 * A model call's request against the previous call's on the same branch, reconstructed read-only with
 * pi's `buildSessionProjection` (the projection behind `buildSessionContext`) and the persisted system
 * messages. Nothing is assembled for a model or sent anywhere. `null` when the call is unknown.
 */
export async function buildRequestDiff(
	store: TraceStore,
	file: string,
	trace: BuiltTrace,
	callId: string,
): Promise<RequestDiff | null> {
	const calls = trace.events.filter((event): event is LlmEvent => event.kind === "llm");
	const at = calls.findIndex((call) => call.id === callId);
	const current = calls[at];
	const source = trace.sources.get(callId);
	if (!current || !source || callId.startsWith("@")) return null;
	const previous = at > 0 ? (calls[at - 1] ?? null) : null;
	const entries = await readEntries(file, source.range.offset + source.range.length);
	const byId = new Map<string, SessionEntry>();
	for (const entry of entries) if (typeof entry.id === "string") byId.set(entry.id, entry);
	const parentOf = (id: string) => byId.get(id)?.parentId ?? null;
	if (!byId.has(callId)) return null;
	const redactor = store.redaction;
	const now = requestAt(entries, byId, parentOf(callId));
	const before =
		previous && byId.has(previous.id) ? requestAt(entries, byId, parentOf(previous.id)) : null;

	const turnOf = turnsOf(trace.events);
	const turnN = new Map<string, number>();
	for (const event of trace.events) if (event.kind === "turn") turnN.set(event.id, event.n);
	const turnNumber = (id: string) => {
		const turn = turnOf.get(id);
		return turn ? (turnN.get(turn) ?? null) : null;
	};
	const counted = countedCalls(trace).find((item) => item.event.id === callId);

	const known = new Map(before?.messages.map((message) => [message.key, message]) ?? []);
	const states = now.messages.map((message) => {
		const prior = known.get(message.key);
		if (!before) return "same" as const;
		if (!prior) return "new" as const;
		return prior.signature === message.signature ? ("same" as const) : ("changed" as const);
	});
	const leadingSame = states.findIndex((state) => state !== "same");
	const sameRun = leadingSame === -1 ? states.length : leadingSame;
	const toMessage = (
		message: Listed,
		index: number,
		state: RequestMessage["state"],
	): RequestMessage => ({
		index,
		role: message.role,
		label: messageLabel(message.message, redactor),
		chars: messageChars(message.message),
		state,
		eventId: trace.entries.get(message.entryId)?.event ?? null,
	});
	const listed: RequestMessage[] = [];
	now.messages.forEach((message, index) => {
		const state = states[index] ?? "same";
		const edge =
			index < EDGE_MESSAGES ||
			(index < sameRun && index >= sameRun - EDGE_MESSAGES) ||
			(sameRun === states.length && index >= states.length - EDGE_MESSAGES);
		if (state !== "same" || edge) listed.push(toMessage(message, index + 1, state));
	});
	const kept = new Set(now.messages.map((message) => message.key));
	const removedAll = before?.messages.filter((message) => !kept.has(message.key)) ?? [];

	const sections = sectionDiffs(before?.system ?? null, now.system, redactor);
	const tools = toolDiff(before?.system ?? null, now.system);
	let firstDifference: FirstDifference = { kind: "none" };
	if (before) {
		const changedSection = sections.find((section) => section.status !== "same");
		const firstMessage = now.messages.findIndex(
			(message, index) => before.messages[index]?.key !== message.key || states[index] !== "same",
		);
		if (tools.added.length + tools.removed.length + tools.changed.length > 0)
			firstDifference = { kind: "tools" };
		else if (changedSection) firstDifference = { kind: "system", section: changedSection.name };
		else if (firstMessage !== -1) firstDifference = { kind: "message", index: firstMessage + 1 };
	}
	const gapMs = previous ? Math.max(0, current.t0 - previous.t1) : null;
	const compacted =
		before !== null &&
		(removedAll.length > 0 ||
			now.messages.some(
				(message) => message.role === "compactionSummary" && !known.has(message.key),
			));
	const edited = states.includes("changed") || (counted?.changes.contextEdits ?? 0) > 0;
	const checks: MissCheck[] = [
		{
			cause: "modelChange",
			found: previous !== null && previous.model !== null && previous.model !== current.model,
		},
		{ cause: "modelReselected", found: (counted?.changes.models.length ?? 0) > 0 },
		{ cause: "systemPrompt", found: sections.some((section) => section.status !== "same") },
		{
			cause: "tools",
			found: tools.added.length + tools.removed.length + tools.changed.length > 0,
		},
		{ cause: "compaction", found: compacted },
		{ cause: "contextEdit", found: edited },
		{ cause: "thinkingLevel", found: counted?.changes.thinkingLevel ?? false },
		{ cause: "pause", found: gapMs !== null && gapMs > CACHE_TTL_MS },
	];
	return {
		current: side(current, at + 1, turnNumber(current.id), now),
		previous: previous && before ? side(previous, at, turnNumber(previous.id), before) : null,
		gapMs,
		newTurn: previous !== null && turnOf.get(previous.id) !== turnOf.get(current.id),
		miss: counted?.miss ?? false,
		checks,
		firstDifference,
		sections,
		tools,
		messages: listed.slice(0, MAX_LISTED),
		removed: removedAll
			.slice(0, MAX_REMOVED)
			.map((message) =>
				toMessage(message, (before?.messages.indexOf(message) ?? 0) + 1, "removed"),
			),
		removedCount: removedAll.length,
		newCount: states.filter((state) => state !== "same").length,
	};
}
