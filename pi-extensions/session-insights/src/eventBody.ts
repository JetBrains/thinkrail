import type { CappedJson, EventBody, IssuedCall, TraceEvent } from "./core.ts";
import type { Redactor } from "./redact.ts";
import { isRecord } from "./totals.ts";
import { contentText, type EventSource } from "./trace.ts";

/** Character caps after redaction; the original sizes travel with the capped text. */
export const BODY_CAPS = {
	prompt: 20_000,
	reply: 16_000,
	thinking: 8_000,
	error: 4_000,
	result: 16_000,
	text: 8_000,
	task: 8_000,
	argString: 6_000,
	detailString: 4_000,
	rawString: 2_000,
} as const;
export type BodyCaps = { readonly [K in keyof typeof BODY_CAPS]: number };

/** Caps and whether to send the raw entries (an export leaves them out). */
export interface BodyOptions {
	caps?: BodyCaps;
	raw?: boolean;
}

const STRING_LADDER = [1_000, 240] as const;
const INPUT_MAX_CHARS = 120_000;
const DETAILS_MAX_CHARS = 32_000;
const RAW_MAX_CHARS = 120_000;

export interface ParsedSource {
	entry: Record<string, unknown>;
	result: Record<string, unknown> | null;
}

function message(entry: Record<string, unknown> | null): Record<string, unknown> {
	return entry && isRecord(entry.message) ? entry.message : {};
}

function blocks(entry: Record<string, unknown> | null): unknown[] {
	const content = message(entry).content;
	return Array.isArray(content) ? content : [];
}

function count(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function imageCount(content: unknown): number {
	return Array.isArray(content)
		? content.filter((block) => isRecord(block) && block.type === "image").length
		: 0;
}

function toolCallAt(entry: Record<string, unknown>, index: number | undefined) {
	if (index === undefined) return null;
	const calls = blocks(entry).filter((block) => isRecord(block) && block.type === "toolCall");
	const call = calls[index];
	return isRecord(call) ? call : null;
}

function rawOf(redactor: Redactor, value: unknown, caps: BodyCaps): CappedJson {
	return redactor.capJsonWithin(value, [caps.rawString, ...STRING_LADDER], RAW_MAX_CHARS);
}

function llmBody(
	redactor: Redactor,
	entry: Record<string, unknown>,
	issued: readonly IssuedCall[],
	caps: BodyCaps,
): Partial<EventBody> {
	const assistant = message(entry);
	const content = blocks(entry);
	const reply = contentText(content);
	const thinking: string[] = [];
	let encrypted = 0;
	for (const block of content) {
		if (!isRecord(block) || block.type !== "thinking") continue;
		if (typeof block.thinking === "string" && block.thinking.trim()) thinking.push(block.thinking);
		else if (block.redacted === true || typeof block.thinkingSignature === "string") encrypted += 1;
	}
	const usage = isRecord(assistant.usage) ? assistant.usage : {};
	const error = typeof assistant.errorMessage === "string" ? assistant.errorMessage : "";
	const provider = typeof assistant.provider === "string" ? assistant.provider : null;
	const model =
		typeof assistant.responseModel === "string"
			? assistant.responseModel
			: typeof assistant.model === "string"
				? assistant.model
				: null;
	return {
		...(reply ? { reply: redactor.cap(reply, caps.reply) } : {}),
		...(thinking.length > 0
			? { thinking: redactor.cap(thinking.join("\n\n"), caps.thinking) }
			: {}),
		...(encrypted > 0 ? { encryptedThinking: encrypted } : {}),
		...(error ? { error: redactor.cap(error, caps.error) } : {}),
		issued,
		model: provider && model ? `${provider}/${model}` : model,
		stop: typeof assistant.stopReason === "string" ? assistant.stopReason : null,
		requestedAt: typeof assistant.timestamp === "number" ? assistant.timestamp : null,
		usage: {
			input: count(usage.input),
			output: count(usage.output),
			cacheRead: count(usage.cacheRead),
			cacheWrite: count(usage.cacheWrite),
			context: count(usage.input) + count(usage.cacheRead) + count(usage.cacheWrite),
			reasoning: typeof usage.reasoning === "number" ? usage.reasoning : null,
			cost: isRecord(usage.cost) ? count(usage.cost.total) : 0,
		},
	};
}

function toolBody(
	redactor: Redactor,
	source: EventSource,
	parsed: ParsedSource,
	caps: BodyCaps,
	withRaw: boolean,
): Partial<EventBody> & { raw: CappedJson[] } {
	const call = toolCallAt(parsed.entry, source.callIndex);
	const result = parsed.result ? message(parsed.result) : null;
	const resultText = result ? contentText(result.content) : "";
	const isError = result?.isError === true;
	const name =
		(typeof call?.name === "string" ? call.name : null) ??
		(typeof result?.toolName === "string" ? result.toolName : "");
	const raw: CappedJson[] = [];
	if (withRaw) {
		if (call) raw.push(rawOf(redactor, call, caps));
		if (parsed.result) raw.push(rawOf(redactor, parsed.result, caps));
		else if (!call) raw.push(rawOf(redactor, parsed.entry, caps));
	}
	const body: Partial<EventBody> & { raw: CappedJson[] } = {
		tool: name,
		raw,
		...(source.toolCallId ? { toolCallId: source.toolCallId } : {}),
	};
	if (call)
		body.input = redactor.capJsonWithin(
			call.arguments ?? null,
			[caps.argString, ...STRING_LADDER],
			INPUT_MAX_CHARS,
		);
	if (result) {
		body.result = redactor.capHeadTail(resultText, caps.result);
		if (isError) body.error = redactor.cap(resultText, caps.error);
		const images = imageCount(result.content);
		if (images > 0) body.resultImages = images;
		if (withRaw && result.details !== undefined && result.details !== null)
			body.details = redactor.capJsonWithin(
				result.details,
				[caps.detailString, ...STRING_LADDER],
				DETAILS_MAX_CHARS,
			);
	}
	if (call && typeof call.arguments === "object" && isRecord(call.arguments)) {
		const task = call.arguments.task;
		if (typeof task === "string" && task) body.task = redactor.cap(task, caps.task);
	}
	return body;
}

function markBody(
	redactor: Redactor,
	entry: Record<string, unknown>,
	caps: BodyCaps,
): Partial<EventBody> {
	const source =
		entry.type === "message" ? contentText(message(entry).content) : contentText(entry.content);
	const summary = typeof entry.summary === "string" ? entry.summary : "";
	const value = summary || source || (typeof entry.name === "string" ? entry.name : "");
	return value ? { text: redactor.cap(value, caps.text) } : {};
}

/**
 * The capped, redacted bodies of one event from the entries its source ranges point at. An export passes
 * its own caps and `raw: false`, which also leaves out a tool result's `details`.
 */
export function eventBody(
	redactor: Redactor,
	event: TraceEvent,
	source: EventSource,
	parsed: ParsedSource,
	issued: readonly IssuedCall[],
	options: BodyOptions = {},
): EventBody {
	const caps = options.caps ?? BODY_CAPS;
	const withRaw = options.raw ?? true;
	const raw = (value: unknown) => (withRaw ? [rawOf(redactor, value, caps)] : []);
	switch (event.kind) {
		case "turn": {
			if (event.trigger !== "prompt")
				return {
					kind: event.kind,
					...markBody(redactor, parsed.entry, caps),
					raw: raw(parsed.entry),
				};
			const content = message(parsed.entry).content;
			const images = imageCount(content);
			return {
				kind: event.kind,
				prompt: redactor.cap(contentText(content), caps.prompt),
				...(images > 0 ? { images } : {}),
				raw: raw(parsed.entry),
			};
		}
		case "llm":
			return {
				kind: event.kind,
				...llmBody(redactor, parsed.entry, issued, caps),
				raw: raw(parsed.entry),
			};
		case "tool":
		case "subagent":
			return { kind: event.kind, ...toolBody(redactor, source, parsed, caps, withRaw) };
		case "mark":
			return {
				kind: event.kind,
				...markBody(redactor, parsed.entry, caps),
				raw: raw(parsed.entry),
			};
	}
}
