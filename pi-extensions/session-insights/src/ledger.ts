import { CONTEXT_CATEGORIES, type ContextCategory } from "./core.ts";
import { digest } from "./facts.ts";
import { isRecord } from "./totals.ts";

/** pi's own estimate (`estimateTokens` in its compaction): four characters a token, an image as 4,800. */
const CHARS_PER_TOKEN = 4;
const IMAGE_CHARS = 4800;
const CATEGORIES = CONTEXT_CATEGORIES.length;

const AT: Readonly<Record<ContextCategory, number>> = {
	tools: 0,
	system: 1,
	skills: 2,
	summary: 3,
	user: 4,
	assistant: 5,
	results: 6,
	thinking: 7,
};

export type Vector = number[];

export function emptyVector(): Vector {
	return new Array<number>(CATEGORIES).fill(0);
}

function vectorOf(category: ContextCategory, chars: number): Vector {
	const vector = emptyVector();
	vector[AT[category]] = chars / CHARS_PER_TOKEN;
	return vector;
}

function add(into: Vector, from: Vector, sign = 1): void {
	for (let at = 0; at < CATEGORIES; at++) into[at] = (into[at] ?? 0) + sign * (from[at] ?? 0);
}

/** A section's or tool's size and a fingerprint of its text, so an equal-size replacement still differs. */
export interface Measure {
	chars: number;
	hash: string;
}

function measure(text: string): Measure {
	return { chars: text.length, hash: digest(text) };
}

function sameMeasure(a: Measure | undefined, b: Measure | undefined): boolean {
	return a?.chars === b?.chars && a?.hash === b?.hash;
}

/** A system message's patch: sections by name (`null` removes one), appended content, tool changes. */
export interface SystemPatch {
	content: number;
	sections: readonly (readonly [string, Measure | null])[];
	added: readonly (readonly [string, Measure])[];
	removed: readonly string[];
}

/** What an entry adds to the requests after it, measured once while the file is read (no text kept). */
export type EntryContext =
	| { kind: "system"; patch: SystemPatch }
	| { kind: "item"; vector: Vector }
	| {
			kind: "assistant";
			text: number;
			calls: number;
			thinking: number;
			output: number;
			reasoning: number | null;
	  }
	| {
			kind: "compaction";
			summary: number;
			firstKept: string | null;
			checkpoint: SystemPatch | null;
	  }
	| { kind: "edit"; target: string; chars: number | null };

function contentChars(content: unknown): number {
	if (typeof content === "string") return content.length;
	if (!Array.isArray(content)) return 0;
	let chars = 0;
	for (const block of content) {
		if (!isRecord(block)) continue;
		if (block.type === "text" && typeof block.text === "string") chars += block.text.length;
		else if (block.type === "image") chars += IMAGE_CHARS;
	}
	return chars;
}

function serialized(value: unknown): string {
	try {
		return JSON.stringify(value ?? null) ?? "";
	} catch {
		return "";
	}
}

function finite(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function systemPatch(message: Record<string, unknown>): SystemPatch {
	const sections: [string, Measure | null][] = [];
	if (isRecord(message.sections))
		for (const [name, value] of Object.entries(message.sections))
			sections.push([name, typeof value === "string" ? measure(value) : null]);
	const added: [string, Measure][] = [];
	for (const tool of Array.isArray(message.toolsAdded) ? message.toolsAdded : [])
		if (isRecord(tool) && typeof tool.name === "string")
			added.push([tool.name, measure(serialized(tool))]);
	const removed: string[] = [];
	for (const tool of Array.isArray(message.toolsRemoved) ? message.toolsRemoved : [])
		if (isRecord(tool) && typeof tool.name === "string") removed.push(tool.name);
	return { content: contentChars(message.content), sections, added, removed };
}

function assistantContext(message: Record<string, unknown>): EntryContext {
	let text = 0;
	let calls = 0;
	let thinking = 0;
	for (const block of Array.isArray(message.content) ? message.content : []) {
		if (!isRecord(block)) continue;
		if (block.type === "text" && typeof block.text === "string") text += block.text.length;
		else if (block.type === "thinking" && typeof block.thinking === "string")
			thinking += block.thinking.length;
		else if (block.type === "toolCall")
			calls +=
				(typeof block.name === "string" ? block.name.length : 0) +
				serialized(block.arguments).length;
	}
	const usage = isRecord(message.usage) ? message.usage : {};
	return {
		kind: "assistant",
		text,
		calls,
		thinking,
		output: finite(usage.output) ?? 0,
		reasoning: finite(usage.reasoning),
	};
}

/** The context facts of one pi entry, or `null` for entries that never reach a request. */
export function entryContext(entry: Record<string, unknown>): EntryContext | null {
	switch (entry.type) {
		case "message": {
			const message = isRecord(entry.message) ? entry.message : null;
			if (!message) return null;
			switch (message.role) {
				case "system":
					return { kind: "system", patch: systemPatch(message) };
				case "assistant":
					return assistantContext(message);
				case "toolResult":
					return { kind: "item", vector: vectorOf("results", contentChars(message.content)) };
				case "bashExecution": {
					const command = typeof message.command === "string" ? message.command.length : 0;
					const output = typeof message.output === "string" ? message.output.length : 0;
					return { kind: "item", vector: vectorOf("user", command + output) };
				}
				default:
					return { kind: "item", vector: vectorOf("user", contentChars(message.content)) };
			}
		}
		case "custom_message":
			return { kind: "item", vector: vectorOf("user", contentChars(entry.content)) };
		case "branch_summary":
			return typeof entry.summary === "string" && entry.summary
				? { kind: "item", vector: vectorOf("summary", entry.summary.length) }
				: null;
		case "compaction":
			return {
				kind: "compaction",
				summary: typeof entry.summary === "string" ? entry.summary.length : 0,
				firstKept: typeof entry.firstKeptEntryId === "string" ? entry.firstKeptEntryId : null,
				checkpoint: isRecord(entry.systemMessage) ? systemPatch(entry.systemMessage) : null,
			};
		case "context_edit": {
			if (typeof entry.targetId !== "string") return null;
			const replacement = isRecord(entry.replacement) ? entry.replacement : null;
			return {
				kind: "edit",
				target: entry.targetId,
				chars: replacement ? contentChars(replacement.content) : null,
			};
		}
		default:
			return null;
	}
}

function assistantVector(context: Extract<EntryContext, { kind: "assistant" }>): Vector {
	const vector = emptyVector();
	const visible = context.text + context.calls;
	if (context.output > 0 && visible + context.thinking > 0) {
		const thinking =
			context.reasoning !== null
				? Math.min(context.reasoning, context.output)
				: (context.output * context.thinking) / (visible + context.thinking);
		vector[AT.thinking] = thinking;
		vector[AT.assistant] = context.output - thinking;
	} else {
		vector[AT.thinking] = context.thinking / CHARS_PER_TOKEN;
		vector[AT.assistant] = visible / CHARS_PER_TOKEN;
	}
	return vector;
}

function sectionCategory(name: string): ContextCategory {
	if (name === "skills") return "skills";
	if (name === "tools") return "tools";
	return "system";
}

/** What changed in the requests' input since the previous model call, for the cache-miss heuristic. */
export interface ContextChanges {
	sections: string[];
	tools: string[];
	compaction: boolean;
	contextEdits: number;
	/** Models a `model_change` entry selected. */
	models: string[];
	thinkingLevel: boolean;
}

export function noChanges(): ContextChanges {
	return {
		sections: [],
		tools: [],
		compaction: false,
		contextEdits: 0,
		models: [],
		thinkingLevel: false,
	};
}

export function mergeChanges(into: ContextChanges, from: ContextChanges): void {
	for (const name of from.sections) if (!into.sections.includes(name)) into.sections.push(name);
	for (const name of from.tools) if (!into.tools.includes(name)) into.tools.push(name);
	into.compaction ||= from.compaction;
	into.contextEdits += from.contextEdits;
	into.models.push(...from.models);
	into.thinkingLevel ||= from.thinkingLevel;
}

export interface CallContext {
	/** Estimated tokens per `CONTEXT_CATEGORIES` before scaling. */
	estimate: Vector;
	/** The branch had a persisted system message (prompt sections or tools) before the call. */
	system: boolean;
	changes: ContextChanges;
}

interface Item {
	pos: number;
	vector: Vector;
}

/**
 * Replays the active branch the way pi builds a request: system patches by section, tools by name, the
 * latest compaction's summary and kept range, context edits; `snapshot()` is the estimate of the request
 * a model call sent, so it is taken before the call's own message is applied.
 */
export class ContextLedger {
	private readonly sections = new Map<string, Measure>();
	private readonly tools = new Map<string, Measure>();
	private content = 0;
	private readonly items = new Map<string, Item>();
	private readonly positions = new Map<string, number>();
	private readonly overrides = new Map<string, Vector>();
	private start = 0;
	private summary = 0;
	private readonly sum = emptyVector();
	private changes = noChanges();
	private pos = 0;

	private inRange(item: Item): boolean {
		return item.pos >= this.start;
	}

	private effective(id: string, item: Item): Vector {
		return this.overrides.get(id) ?? item.vector;
	}

	private rebuild(): void {
		this.sum.fill(0);
		for (const [id, item] of this.items)
			if (this.inRange(item)) add(this.sum, this.effective(id, item));
	}

	private patch(patch: SystemPatch, track: boolean): void {
		this.content += patch.content;
		for (const [name, section] of patch.sections) {
			const before = this.sections.get(name);
			if (section === null) this.sections.delete(name);
			else this.sections.set(name, section);
			if (
				track &&
				!sameMeasure(before, section ?? undefined) &&
				!this.changes.sections.includes(name)
			)
				this.changes.sections.push(name);
		}
		for (const name of patch.removed) {
			if (track && this.tools.has(name) && !this.changes.tools.includes(name))
				this.changes.tools.push(name);
			this.tools.delete(name);
		}
		for (const [name, tool] of patch.added) {
			if (track && !sameMeasure(this.tools.get(name), tool) && !this.changes.tools.includes(name))
				this.changes.tools.push(name);
			this.tools.set(name, tool);
		}
	}

	/** The request a model call would send now, by category. */
	snapshot(): Vector {
		const vector = [...this.sum];
		vector[AT.summary] = (vector[AT.summary] ?? 0) + this.summary / CHARS_PER_TOKEN;
		vector[AT.system] = (vector[AT.system] ?? 0) + this.content / CHARS_PER_TOKEN;
		for (const [name, { chars }] of this.sections) {
			const at = AT[sectionCategory(name)];
			vector[at] = (vector[at] ?? 0) + chars / CHARS_PER_TOKEN;
		}
		let tools = 0;
		for (const { chars } of this.tools.values()) tools += chars;
		vector[AT.tools] = (vector[AT.tools] ?? 0) + tools / CHARS_PER_TOKEN;
		return vector;
	}

	/** Whether a system message (or a compaction checkpoint) declared a prompt or tools so far. */
	hasSystem(): boolean {
		return this.content > 0 || this.sections.size > 0 || this.tools.size > 0;
	}

	/** The changes since the last call to `take`, which starts a new set. */
	take(): ContextChanges {
		const changes = this.changes;
		this.changes = noChanges();
		return changes;
	}

	noteModel(model: string | null): void {
		if (model) this.changes.models.push(model);
	}

	noteThinkingLevel(): void {
		this.changes.thinkingLevel = true;
	}

	apply(id: string, context: EntryContext | null): void {
		const pos = this.pos++;
		this.positions.set(id, pos);
		if (!context) return;
		switch (context.kind) {
			case "system":
				this.patch(context.patch, true);
				return;
			case "item":
			case "assistant": {
				const vector = context.kind === "item" ? context.vector : assistantVector(context);
				const item = { pos, vector };
				this.items.set(id, item);
				add(this.sum, vector);
				return;
			}
			case "compaction": {
				const kept = context.firstKept === null ? undefined : this.positions.get(context.firstKept);
				this.start = kept ?? pos;
				this.summary = context.summary;
				if (context.checkpoint) {
					this.sections.clear();
					this.tools.clear();
					this.content = 0;
					this.patch(context.checkpoint, false);
				}
				this.changes.compaction = true;
				this.rebuild();
				return;
			}
			case "edit": {
				const item = this.items.get(context.target);
				this.changes.contextEdits += 1;
				if (!item) return;
				const before = this.effective(context.target, item);
				const after = emptyVector();
				if (context.chars !== null) {
					let main = 0;
					for (let at = 1; at < CATEGORIES; at++)
						if ((item.vector[at] ?? 0) > (item.vector[main] ?? 0)) main = at;
					after[main] = context.chars / CHARS_PER_TOKEN;
				}
				this.overrides.set(context.target, after);
				if (this.inRange(item)) {
					add(this.sum, before, -1);
					add(this.sum, after);
				}
				return;
			}
		}
	}
}

/**
 * Scales an estimate to an exact total by largest remainder: integers that sum to `total`. An empty
 * estimate puts nothing anywhere but the total stays exact elsewhere (`coverage` 0).
 */
export function scaleToTotal(estimate: readonly number[], total: number): number[] {
	const sum = estimate.reduce((acc, value) => acc + Math.max(0, value), 0);
	if (sum <= 0 || total <= 0) return estimate.map(() => 0);
	const raw = estimate.map((value) => (Math.max(0, value) * total) / sum);
	const out = raw.map(Math.floor);
	let left = total - out.reduce((acc, value) => acc + value, 0);
	const order = raw
		.map((value, at) => ({ at, rest: value - Math.floor(value) }))
		.sort((a, b) => b.rest - a.rest || a.at - b.at);
	for (const { at } of order) {
		if (left <= 0) break;
		out[at] = (out[at] ?? 0) + 1;
		left -= 1;
	}
	return out;
}
