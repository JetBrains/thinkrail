import type { PiEventOf } from "@thinkrail/ext";

export const TRACKED_EVENTS = [
	"agent_start",
	"turn_start",
	"message_end",
	"turn_end",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
	"compaction_start",
	"compaction_end",
	"agent_settled",
] as const;

type TrackedEvent = PiEventOf<(typeof TRACKED_EVENTS)[number]>;

const MAX_SPANS = 400;
const PREVIEW_CHARS = 600;
const LABEL_CHARS = 80;

type SpanKind = "turn" | "tool" | "compaction";
type SpanStatus = "running" | "ok" | "error";

interface SpanTokens {
	in: number;
	out: number;
	cacheRead: number;
}

export interface Span {
	id: string;
	sessionId: string;
	run: number;
	parentId?: string;
	kind: SpanKind;
	name: string;
	label?: string;
	start: number;
	end?: number;
	status: SpanStatus;
	tokens?: SpanTokens;
	costUsd?: number;
	preview?: string;
}

export interface Timeline {
	sessionId: string;
	live: boolean;
	run: number;
	turn: number;
	compactions: number;
	dropped: number;
	spans: Span[];
}

export const createTimeline = (sessionId: string): Timeline => ({
	sessionId,
	live: false,
	run: 0,
	turn: 0,
	compactions: 0,
	dropped: 0,
	spans: [],
});

const clip = (text: string, max: number) =>
	text.length > max ? `…${text.slice(text.length - max + 1)}` : text;

const head = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const stringify = (value: unknown) => {
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return String(value);
	}
};

const previewOf = (value: unknown) => {
	if (typeof value === "string") return clip(value.trim(), PREVIEW_CHARS);
	if (isRecord(value) && Array.isArray(value.content)) {
		const text = value.content
			.flatMap((part) => (isRecord(part) && typeof part.text === "string" ? [part.text] : []))
			.join("\n")
			.trim();
		return text ? clip(text, PREVIEW_CHARS) : undefined;
	}
	return value === undefined ? undefined : clip(stringify(value), PREVIEW_CHARS);
};

const ARG_KEYS = ["command", "path", "file_path", "pattern", "query", "url", "description"];

const labelOf = (args: unknown) => {
	if (!isRecord(args)) return undefined;
	const key = ARG_KEYS.find((candidate) => typeof args[candidate] === "string");
	const text = key ? String(args[key]) : stringify(args);
	return text && text !== "{}" ? head(text.replace(/\s+/g, " ").trim(), LABEL_CHARS) : undefined;
};

const currentTurn = (timeline: Timeline) =>
	timeline.turn > 0 ? `r${timeline.run}t${timeline.turn}` : undefined;

const update = (timeline: Timeline, id: string, patch: (span: Span) => Span): Timeline => ({
	...timeline,
	spans: timeline.spans.map((span) => (span.id === id ? patch(span) : span)),
});

const evict = (timeline: Timeline): Timeline => {
	let { spans, dropped } = timeline;
	while (spans.length > MAX_SPANS) {
		const oldest = spans.find((span) => span.status !== "running");
		if (!oldest) break;
		const before = spans.length;
		spans = spans.filter((span) => span.id !== oldest.id && span.parentId !== oldest.id);
		dropped += before - spans.length;
	}
	return { ...timeline, spans, dropped };
};

const withPreview = (span: Span, preview: string | undefined): Span =>
	preview === undefined ? span : { ...span, preview };

const push = (timeline: Timeline, span: Omit<Span, "sessionId" | "run">): Timeline =>
	evict({
		...timeline,
		spans: [...timeline.spans, { ...span, sessionId: timeline.sessionId, run: timeline.run }],
	});

const ensureRun = (timeline: Timeline): Timeline =>
	timeline.live
		? timeline
		: { ...timeline, live: true, run: timeline.run + 1, turn: 0, compactions: 0 };

type AssistantUsage = Pick<Span, "tokens" | "costUsd" | "label">;

const usageOf = (message: unknown): AssistantUsage | undefined => {
	if (!isRecord(message) || message.role !== "assistant" || !isRecord(message.usage))
		return undefined;
	const { usage } = message;
	const num = (value: unknown) => (typeof value === "number" ? value : 0);
	const cost = isRecord(usage.cost) ? num(usage.cost.total) : 0;
	return {
		tokens: { in: num(usage.input), out: num(usage.output), cacheRead: num(usage.cacheRead) },
		costUsd: cost,
		...(typeof message.model === "string" ? { label: message.model } : {}),
	};
};

const failed = (message: unknown) =>
	isRecord(message) && (message.stopReason === "error" || message.stopReason === "aborted");

const closeRunning = (timeline: Timeline, now: number, status: SpanStatus): Timeline => ({
	...timeline,
	spans: timeline.spans.map((span) =>
		span.status === "running" ? { ...span, end: now, status } : span,
	),
});

const reduceTool = (timeline: Timeline, event: TrackedEvent, now: number): Timeline => {
	switch (event.type) {
		case "tool_execution_start": {
			const live = ensureRun(timeline);
			const parentId = currentTurn(live);
			const label = labelOf(event.args);
			return push(live, {
				id: event.toolCallId,
				kind: "tool",
				name: event.toolName,
				start: now,
				status: "running",
				...(parentId ? { parentId } : {}),
				...(label ? { label } : {}),
			});
		}
		case "tool_execution_update": {
			const preview = previewOf(event.partialResult);
			return update(timeline, event.toolCallId, (span) => withPreview(span, preview));
		}
		case "tool_execution_end": {
			const preview = previewOf(event.result);
			return update(timeline, event.toolCallId, (span) =>
				withPreview({ ...span, end: now, status: event.isError ? "error" : "ok" }, preview),
			);
		}
		default:
			return timeline;
	}
};

export const reduceTimeline = (timeline: Timeline, event: TrackedEvent, now: number): Timeline => {
	switch (event.type) {
		case "agent_start":
			return ensureRun(timeline);
		case "turn_start": {
			const live = ensureRun(timeline);
			const next = { ...live, turn: live.turn + 1 };
			return push(next, {
				id: `r${next.run}t${next.turn}`,
				kind: "turn",
				name: `Turn ${next.turn}`,
				start: now,
				status: "running",
			});
		}
		case "message_end": {
			const id = timeline.live ? currentTurn(timeline) : undefined;
			const usage = usageOf(event.message);
			if (!id || !usage) return timeline;
			const preview = previewOf(event.message);
			return update(timeline, id, (span) => withPreview({ ...span, ...usage }, preview));
		}
		case "turn_end": {
			const id = timeline.live ? currentTurn(timeline) : undefined;
			if (!id) return timeline;
			const usage = usageOf(event.message);
			return update(timeline, id, (span) => ({
				...span,
				...(span.tokens ? {} : usage),
				end: now,
				status: failed(event.message) ? "error" : "ok",
			}));
		}
		case "compaction_start": {
			const next = { ...timeline, compactions: timeline.compactions + 1 };
			return push(next, {
				id: `r${next.run}c${next.compactions}`,
				kind: "compaction",
				name: "Compaction",
				label: event.reason,
				start: now,
				status: "running",
			});
		}
		case "compaction_end": {
			const id = `r${timeline.run}c${timeline.compactions}`;
			const before = event.result?.tokensBefore;
			return update(timeline, id, (span) =>
				span.status !== "running"
					? span
					: {
							...span,
							end: now,
							status: event.aborted || event.errorMessage ? "error" : "ok",
							...(before !== undefined
								? { label: `${event.reason} · ${before} tokens before` }
								: {}),
							...(event.errorMessage ? { preview: event.errorMessage } : {}),
						},
			);
		}
		case "agent_settled": {
			const stop = event.terminal?.stopReason;
			const status = stop === "error" || stop === "aborted" ? "error" : "ok";
			return { ...closeRunning(timeline, now, status), live: false };
		}
		default:
			return reduceTool(timeline, event, now);
	}
};

export const withoutPreviews = (timeline: Timeline): Timeline => ({
	...timeline,
	spans: timeline.spans.map(({ preview: _preview, ...span }) => span),
});

export const previewIn = (timeline: Timeline | undefined, spanId: unknown) =>
	timeline?.spans.find((span) => span.id === spanId)?.preview;

export const isTimeline = (value: unknown): value is Timeline =>
	isRecord(value) &&
	typeof value.sessionId === "string" &&
	typeof value.run === "number" &&
	Array.isArray(value.spans);

export const runningTools = (timeline: Timeline | undefined) =>
	timeline?.spans.filter((span) => span.kind === "tool" && span.status === "running").length ?? 0;
