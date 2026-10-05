import type {
	AssistantMessage,
	PiEvent,
	SessionEventPayload,
	ToolCall,
	ToolResultMessage,
	WsPush,
} from "@thinkrail/contracts";
import type { FixtureMessage } from "@thinkrail/server/history-test-fixtures";

const WORDS = [
	"render",
	"stream",
	"commit",
	"virtual",
	"row",
	"component",
	"measure",
	"scroll",
	"session",
	"workspace",
	"diff",
	"selector",
	"memo",
	"compiler",
	"profile",
	"latency",
	"budget",
	"anchor",
	"layout",
	"token",
];

interface ReplayStep {
	frames: string[];
}

function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

function prose(random: () => number, paragraphs: number): string {
	const blocks: string[] = [];
	for (let p = 0; p < paragraphs; p += 1) {
		const words = Array.from(
			{ length: 40 + Math.floor(random() * 40) },
			() => WORDS[Math.floor(random() * WORDS.length)],
		);
		blocks.push(
			p % 3 === 1
				? words
						.slice(0, 24)
						.reduce<string[]>((lines, word, index) => {
							if (index % 6 === 0) lines.push(`- \`${word}\``);
							else lines[lines.length - 1] += ` ${word}`;
							return lines;
						}, [])
						.join("\n")
				: `${words.join(" ")}.`,
		);
	}
	return blocks.join("\n\n");
}

function chunks(text: string, random: () => number): string[] {
	const out: string[] = [];
	let at = 0;
	while (at < text.length) {
		const size = 3 + Math.floor(random() * 6);
		out.push(text.slice(at, at + size));
		at += size;
	}
	return out;
}

function assistantShell(timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-replay",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

interface ToolPlan {
	call: ToolCall;
	partials: string[];
	result: string;
}

interface MessagePlan {
	text: string;
	tools: ToolPlan[];
}

function toolPlans(turn: number, random: () => number): ToolPlan[] {
	const id = (name: string) => `replay-${turn}-${name}`;
	const output = Array.from(
		{ length: 12 },
		(_, line) => `${line}: ${prose(random, 1).slice(0, 72)}`,
	);
	return [
		{
			call: { type: "toolCall", id: id("read"), name: "read", arguments: { path: "src/app.ts" } },
			partials: [],
			result: prose(random, 2),
		},
		{
			call: {
				type: "toolCall",
				id: id("bash"),
				name: "bash",
				arguments: { command: "bun test --filter render" },
			},
			partials: output.map((_, line) => output.slice(0, line + 1).join("\n")),
			result: output.join("\n"),
		},
	];
}

function toolResultContent(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

export interface ChatReplay {
	steps: ReplayStep[];
	finalText: string;
}

export function buildChatReplay(sessionId: string, seed = 7): ChatReplay {
	const random = seededRandom(seed);
	const plans: MessagePlan[] = [
		{ text: prose(random, 4), tools: toolPlans(1, random) },
		{ text: prose(random, 4), tools: toolPlans(2, random) },
		{ text: prose(random, 7), tools: [] },
	];
	const push = (event: PiEvent) => {
		const payload: SessionEventPayload = { sessionId, event };
		const frame: WsPush = { channel: "pi.event", data: payload };
		return JSON.stringify(frame);
	};
	const steps: ReplayStep[] = [{ frames: [push({ type: "agent_start" })] }];
	let timestamp = 1_701_000_000_000;

	for (const plan of plans) {
		timestamp += 1_000;
		const message = assistantShell(timestamp);
		steps.push({
			frames: [
				push({ type: "turn_start" }),
				push({ type: "message_start", message }),
				push({
					type: "message_update",
					message,
					assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: message },
				}),
			],
		});
		let text = "";
		const pieces = chunks(plan.text, random);
		for (let index = 0; index < pieces.length; index += 3) {
			const frames: string[] = [];
			for (const piece of pieces.slice(index, index + 3)) {
				text += piece;
				const partial: AssistantMessage = { ...message, content: [{ type: "text", text }] };
				frames.push(
					push({
						type: "message_update",
						message: partial,
						assistantMessageEvent: {
							type: "text_delta",
							contentIndex: 0,
							delta: piece,
							partial,
						},
					}),
				);
			}
			steps.push({ frames });
		}
		const calls = plan.tools.map((tool) => tool.call);
		const final: AssistantMessage = {
			...message,
			content: [{ type: "text", text }, ...calls],
			stopReason: calls.length > 0 ? "toolUse" : "stop",
		};
		for (const [index, call] of calls.entries()) {
			const partial: AssistantMessage = {
				...message,
				content: [{ type: "text", text }, ...calls.slice(0, index + 1)],
			};
			steps.push({
				frames: [
					push({
						type: "message_update",
						message: partial,
						assistantMessageEvent: {
							type: "toolcall_end",
							contentIndex: index + 1,
							toolCall: call,
							partial,
						},
					}),
				],
			});
		}
		steps.push({
			frames: [
				push({
					type: "message_update",
					message: final,
					assistantMessageEvent: {
						type: "done",
						reason: calls.length > 0 ? "toolUse" : "stop",
						message: final,
					},
				}),
				push({ type: "message_end", message: final }),
			],
		});
		const results: ToolResultMessage[] = [];
		for (const tool of plan.tools) {
			const { id, name, arguments: args } = tool.call;
			steps.push({
				frames: [push({ type: "tool_execution_start", toolCallId: id, toolName: name, args })],
			});
			for (const partial of tool.partials)
				steps.push({
					frames: [
						push({
							type: "tool_execution_update",
							toolCallId: id,
							toolName: name,
							args,
							partialResult: toolResultContent(partial),
						}),
					],
				});
			timestamp += 100;
			const result: ToolResultMessage = {
				role: "toolResult",
				toolCallId: id,
				toolName: name,
				content: [{ type: "text", text: tool.result }],
				isError: false,
				timestamp,
			};
			results.push(result);
			steps.push({
				frames: [
					push({
						type: "tool_execution_end",
						toolCallId: id,
						toolName: name,
						result: toolResultContent(tool.result),
						isError: false,
					}),
					push({ type: "message_start", message: result }),
					push({ type: "message_end", message: result }),
				],
			});
		}
		steps.push({ frames: [push({ type: "turn_end", message: final, toolResults: results })] });
	}
	steps.push({
		frames: [
			push({ type: "agent_end", messages: [], willRetry: false }),
			push({ type: "agent_settled", terminal: null }),
		],
	});
	const last = plans.at(-1);
	return {
		steps,
		finalText: last ? last.text.slice(-40) : "",
	};
}

export function chatHistory(baseTimestamp: number, exchanges: number, seed = 11): FixtureMessage[] {
	const random = seededRandom(seed);
	const messages: FixtureMessage[] = [];
	for (let turn = 0; turn < exchanges; turn += 1) {
		const at = baseTimestamp + turn * 10_000;
		messages.push({ role: "user", text: `Step ${turn}: ${prose(random, 1)}`, timestamp: at });
		const callId = `history-${turn}`;
		messages.push({
			role: "assistant",
			timestamp: at + 1_000,
			stopReason: "toolUse",
			content: [
				{ type: "text", text: prose(random, 2) },
				{ type: "toolCall", id: callId, name: "read", arguments: { path: `src/file-${turn}.ts` } },
			],
		});
		messages.push({
			role: "toolResult",
			toolCallId: callId,
			toolName: "read",
			content: [{ type: "text", text: prose(random, 1) }],
			isError: false,
			timestamp: at + 2_000,
		});
		messages.push({ role: "assistant", text: prose(random, 3), timestamp: at + 3_000 });
	}
	return messages;
}
