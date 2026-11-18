import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface PiUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

/** A model call's usage with an explicit cache split. */
export function cached(
	split: { input: number; cacheRead?: number; cacheWrite?: number; output?: number },
	cost: number,
): PiUsage {
	const cacheRead = split.cacheRead ?? 0;
	const cacheWrite = split.cacheWrite ?? 0;
	const output = split.output ?? 100;
	return {
		input: split.input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: split.input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
	};
}

export function usage(tokens: number, cost: number): PiUsage {
	return {
		input: tokens,
		output: tokens + 1,
		cacheRead: tokens + 2,
		cacheWrite: tokens + 3,
		totalTokens: 4 * tokens + 6,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
	};
}

export function runDetails(
	childSessionId: string,
	status: string,
	spend: { tokens: number; cost: number },
	durationMs = 1000,
) {
	return {
		childSessionId,
		task: "Investigate",
		status,
		model: "faux/faux-child",
		usage: {
			input: spend.tokens,
			output: spend.tokens + 1,
			cacheRead: spend.tokens + 2,
			cacheWrite: spend.tokens + 3,
			cost: spend.cost,
			turns: 1,
			contextTokens: 0,
		},
		durationMs,
	};
}

export interface AssistantOptions {
	text?: string;
	thinking?: readonly ({ thinking: string } | { signature: string })[];
	toolCalls?: readonly { id: string; name: string; arguments?: Record<string, unknown> }[];
	usage?: PiUsage;
	stopReason?: string;
	errorMessage?: string;
	provider?: string;
	model?: string;
	responseModel?: string;
	/** `message.timestamp` (request start); defaults to the entry's time. */
	requestedAt?: number;
	durationMs?: number;
	stepMs?: number;
}

export interface ToolResultOptions {
	toolCallId: string;
	toolName: string;
	text?: string;
	isError?: boolean;
	details?: unknown;
	usage?: PiUsage;
	durationMs?: number;
	stepMs?: number;
}

export class TranscriptBuilder {
	readonly id: string;
	readonly cwd: string;
	private readonly lines: unknown[] = [];
	private clock: number;
	private sequence = 0;
	private parent: string | null = null;

	constructor(
		options: {
			id?: string;
			cwd?: string;
			start?: number;
			version?: number;
			parentSession?: string;
		} = {},
	) {
		this.id = options.id ?? "019f0000-0000-7000-8000-000000000001";
		this.cwd = options.cwd ?? "/work/project";
		this.clock = options.start ?? Date.parse("2026-11-01T10:00:00.000Z");
		this.lines.push({
			type: "session",
			version: options.version ?? 3,
			id: this.id,
			timestamp: new Date(this.clock).toISOString(),
			cwd: this.cwd,
			...(options.parentSession ? { parentSession: options.parentSession } : {}),
		});
	}

	advance(ms: number): this {
		this.clock += ms;
		return this;
	}

	now(): number {
		return this.clock;
	}

	/** The next entry's parent; moving it back starts a branch. */
	branchFrom(id: string | null): this {
		this.parent = id;
		return this;
	}

	entry(fields: Record<string, unknown>, stepMs = 1000): string {
		this.clock += stepMs;
		this.sequence += 1;
		const id = this.sequence.toString(16).padStart(8, "0");
		this.lines.push({
			id,
			parentId: this.parent,
			timestamp: new Date(this.clock).toISOString(),
			...fields,
		});
		this.parent = id;
		return id;
	}

	user(content: unknown): string {
		return this.entry({
			type: "message",
			message: { role: "user", content, timestamp: this.clock },
		});
	}

	assistant(options: AssistantOptions = {}): string {
		const content: unknown[] = [];
		for (const block of options.thinking ?? [])
			content.push(
				"thinking" in block
					? { type: "thinking", thinking: block.thinking }
					: { type: "thinking", thinking: "", thinkingSignature: block.signature },
			);
		if (options.text !== undefined) content.push({ type: "text", text: options.text });
		for (const call of options.toolCalls ?? [])
			content.push({
				type: "toolCall",
				id: call.id,
				name: call.name,
				arguments: call.arguments ?? {},
			});
		const stepMs = options.stepMs ?? 1000;
		return this.entry(
			{
				type: "message",
				message: {
					role: "assistant",
					content,
					api: "faux",
					provider: options.provider ?? "anthropic",
					model: options.model ?? "claude-test",
					...(options.responseModel ? { responseModel: options.responseModel } : {}),
					usage: options.usage ?? usage(10, 0.01),
					stopReason: options.stopReason ?? (options.toolCalls?.length ? "toolUse" : "stop"),
					...(options.errorMessage ? { errorMessage: options.errorMessage } : {}),
					timestamp: options.requestedAt ?? this.clock,
					...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
				},
			},
			stepMs,
		);
	}

	toolResult(options: ToolResultOptions): string {
		const stepMs = options.stepMs ?? 1000;
		return this.entry(
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: options.toolCallId,
					toolName: options.toolName,
					content: [{ type: "text", text: options.text ?? "ok" }],
					isError: options.isError ?? false,
					...(options.details !== undefined ? { details: options.details } : {}),
					...(options.usage ? { usage: options.usage } : {}),
					timestamp: this.clock + stepMs,
					...(options.durationMs !== undefined ? { durationMs: options.durationMs } : {}),
				},
			},
			stepMs,
		);
	}

	sessionInfo(name: string | undefined): string {
		return this.entry({ type: "session_info", ...(name !== undefined ? { name } : {}) });
	}

	modelChange(provider: string, modelId: string): string {
		return this.entry({ type: "model_change", provider, modelId });
	}

	compaction(
		spend?: PiUsage,
		options: {
			firstKept?: string;
			summary?: string;
			tokensBefore?: number;
			checkpoint?: unknown;
		} = {},
	): string {
		return this.entry({
			type: "compaction",
			summary: options.summary ?? "Earlier work.",
			firstKeptEntryId: options.firstKept ?? this.parent,
			tokensBefore: options.tokensBefore ?? 1000,
			...(spend ? { usage: spend } : {}),
			...(options.checkpoint !== undefined ? { systemMessage: options.checkpoint } : {}),
		});
	}

	/** A persisted system message: sections patched by name (`null` removes one) and tool changes. */
	system(
		options: {
			sections?: Record<string, string | null>;
			toolsAdded?: readonly { name: string; description?: string }[];
			toolsRemoved?: readonly string[];
		} = {},
	): string {
		return this.entry({
			type: "message",
			message: {
				role: "system",
				content: "",
				...(options.sections ? { sections: options.sections } : {}),
				...(options.toolsAdded
					? {
							toolsAdded: options.toolsAdded.map((tool) => ({
								name: tool.name,
								description: tool.description ?? `The ${tool.name} tool.`,
								parameters: { type: "object", properties: {} },
							})),
						}
					: {}),
				...(options.toolsRemoved
					? { toolsRemoved: options.toolsRemoved.map((name) => ({ name })) }
					: {}),
				timestamp: this.clock,
			},
		});
	}

	thinkingLevel(level: string): string {
		return this.entry({ type: "thinking_level_change", thinkingLevel: level });
	}

	contextEdit(targetId: string, replacement: string | null): string {
		return this.entry({
			type: "context_edit",
			targetId,
			replacement: replacement === null ? null : { content: replacement },
		});
	}

	usageEntry(kind: string, spend: PiUsage, note?: string): string {
		return this.entry({
			type: "usage",
			kind,
			provider: "faux",
			model: "faux-child",
			usage: spend,
			...(note !== undefined ? { note } : {}),
		});
	}

	customMessage(customType: string, details: unknown, content = "Done."): string {
		return this.entry({ type: "custom_message", customType, content, display: true, details });
	}

	raw(line: string): this {
		this.lines.push(line);
		return this;
	}

	text(): string {
		return this.lines
			.map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
			.join("\n")
			.concat("\n");
	}
}

export function tempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `pi-insights-${prefix}-`));
}

export function writeSession(root: string, folder: string, builder: TranscriptBuilder): string {
	const dir = join(root, folder);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `2026-11-01T10-00-00-000Z_${builder.id}.jsonl`);
	writeFileSync(file, builder.text());
	return file;
}
