import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface FixtureToolCall {
	id: string;
	name: string;
	arguments?: Record<string, unknown>;
}

export type FixtureMessage =
	| { role: "user"; text: string; timestamp: number }
	| { role: "assistant"; text?: string; toolCalls?: FixtureToolCall[]; timestamp: number }
	| {
			role: "toolResult";
			toolCallId: string;
			toolName: string;
			text?: string;
			details?: unknown;
			isError?: boolean;
			timestamp: number;
	  };

function assistantContent(message: Extract<FixtureMessage, { role: "assistant" }>): unknown[] {
	return [
		...(message.text === undefined ? [] : [{ type: "text", text: message.text }]),
		...(message.toolCalls ?? []).map((call) => ({
			type: "toolCall",
			id: call.id,
			name: call.name,
			arguments: call.arguments ?? {},
		})),
	];
}

function agentMessage(message: FixtureMessage): Record<string, unknown> {
	if (message.role === "user") {
		return { role: "user", content: message.text, timestamp: message.timestamp };
	}
	if (message.role === "toolResult") {
		return {
			role: "toolResult",
			toolCallId: message.toolCallId,
			toolName: message.toolName,
			content: [{ type: "text", text: message.text ?? "" }],
			...(message.details === undefined ? {} : { details: message.details }),
			isError: message.isError ?? false,
			timestamp: message.timestamp,
		};
	}
	return {
		role: "assistant",
		content: assistantContent(message),
		stopReason: (message.toolCalls?.length ?? 0) > 0 ? "toolUse" : "stop",
		timestamp: message.timestamp,
	};
}

export function writeFixtureSession(
	dir: string,
	opts: {
		id?: string;
		cwd: string;
		name?: string;
		messages: FixtureMessage[];
	},
): { id: string; path: string } {
	mkdirSync(dir, { recursive: true });

	const sessionId = opts.id ?? `sess-${randomUUID()}`;
	const entryId = (suffix: string) => `${sessionId}-${suffix}`;
	let parentId: string | null = null;
	const lines: string[] = [
		JSON.stringify({
			type: "session",
			version: 3,
			id: sessionId,
			timestamp: new Date(opts.messages[0]?.timestamp ?? Date.now()).toISOString(),
			cwd: opts.cwd,
		}),
	];

	if (opts.name !== undefined) {
		const id = entryId("info");
		lines.push(
			JSON.stringify({
				type: "session_info",
				id,
				parentId,
				timestamp: new Date().toISOString(),
				name: opts.name,
			}),
		);
		parentId = id;
	}

	opts.messages.forEach((m, i) => {
		const id = entryId(`m${i}`);
		lines.push(
			JSON.stringify({
				type: "message",
				id,
				parentId,
				timestamp: new Date(m.timestamp).toISOString(),
				message: agentMessage(m),
			}),
		);
		parentId = id;
	});

	const path = join(dir, `${opts.messages[0]?.timestamp ?? Date.now()}_${sessionId}.jsonl`);
	writeFileSync(path, `${lines.join("\n")}\n`);
	return { id: sessionId, path };
}

export function defaultSessionDirFor(agentDir: string, cwd: string): string {
	const resolvedCwd = resolve(cwd);
	const resolvedAgentDir = resolve(agentDir);
	const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(resolvedAgentDir, "sessions", safePath);
}
