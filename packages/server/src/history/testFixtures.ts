import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AssistantMessage, StopReason, ToolResultMessage, Usage } from "@thinkrail/contracts";

type FixtureAssistantMessage = {
	role: "assistant";
	timestamp: number;
	stopReason?: StopReason;
	errorMessage?: string;
	provider?: string;
	model?: string;
	usage?: Usage;
	durationMs?: number;
} & ({ text: string; content?: never } | { text?: never; content: AssistantMessage["content"] });

export type FixtureMessage =
	| { role: "user"; text: string; timestamp: number }
	| FixtureAssistantMessage
	| {
			role: "toolResult";
			toolCallId: string;
			toolName: string;
			content: ToolResultMessage["content"];
			details?: unknown;
			isError: boolean;
			timestamp: number;
			durationMs?: number;
	  }
	/** A `custom_message` entry, such as an extension's completion message. */
	| { role: "custom"; customType: string; text: string; details?: unknown; timestamp: number }
	/** A persisted system message: prompt sections patched by name and the tool loadout's changes. */
	| {
			role: "system";
			sections?: Record<string, string | null>;
			toolsAdded?: { name: string; description: string; parameters: unknown }[];
			toolsRemoved?: { name: string }[];
			timestamp: number;
	  }
	/** A `compaction` entry keeping the history from the message at index `firstKept` of `messages`. */
	| {
			role: "compaction";
			summary: string;
			tokensBefore: number;
			firstKept: number;
			systemMessage?: unknown;
			timestamp: number;
	  }
	/** A `model_change` entry. */
	| { role: "modelChange"; provider: string; modelId: string; timestamp: number };

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
	const startedAt = new Date(opts.messages[0]?.timestamp ?? Date.now()).toISOString();
	const lines: string[] = [
		JSON.stringify({
			type: "session",
			version: 3,
			id: sessionId,
			timestamp: startedAt,
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
				timestamp: startedAt,
				name: opts.name,
			}),
		);
		parentId = id;
	}

	opts.messages.forEach((m, i) => {
		const id = entryId(`m${i}`);
		const base = { id, parentId, timestamp: new Date(m.timestamp).toISOString() };
		if (m.role === "system") {
			lines.push(
				JSON.stringify({
					type: "message",
					...base,
					message: {
						role: "system",
						content: "",
						...(m.sections ? { sections: m.sections } : {}),
						...(m.toolsAdded ? { toolsAdded: m.toolsAdded } : {}),
						...(m.toolsRemoved ? { toolsRemoved: m.toolsRemoved } : {}),
						timestamp: m.timestamp,
					},
				}),
			);
			parentId = id;
			return;
		}
		if (m.role === "compaction") {
			lines.push(
				JSON.stringify({
					type: "compaction",
					...base,
					summary: m.summary,
					firstKeptEntryId: entryId(`m${m.firstKept}`),
					tokensBefore: m.tokensBefore,
					...(m.systemMessage !== undefined ? { systemMessage: m.systemMessage } : {}),
				}),
			);
			parentId = id;
			return;
		}
		if (m.role === "modelChange") {
			lines.push(
				JSON.stringify({ type: "model_change", ...base, provider: m.provider, modelId: m.modelId }),
			);
			parentId = id;
			return;
		}
		if (m.role === "custom") {
			lines.push(
				JSON.stringify({
					type: "custom_message",
					id,
					parentId,
					timestamp: new Date(m.timestamp).toISOString(),
					customType: m.customType,
					content: m.text,
					display: true,
					...(m.details !== undefined ? { details: m.details } : {}),
				}),
			);
			parentId = id;
			return;
		}
		const content =
			m.role === "user"
				? m.text
				: m.role === "assistant"
					? (m.content ?? [{ type: "text", text: m.text }])
					: m.content;
		lines.push(
			JSON.stringify({
				type: "message",
				id,
				parentId,
				timestamp: new Date(m.timestamp).toISOString(),
				message: {
					role: m.role,
					content,
					timestamp: m.timestamp,
					...(m.role === "assistant" && m.provider !== undefined ? { provider: m.provider } : {}),
					...(m.role === "assistant" && m.model !== undefined ? { model: m.model } : {}),
					...(m.role === "assistant" && m.usage !== undefined ? { usage: m.usage } : {}),
					...(m.role === "assistant" && m.stopReason ? { stopReason: m.stopReason } : {}),
					...(m.role === "assistant" && m.errorMessage !== undefined
						? { errorMessage: m.errorMessage }
						: {}),
					...(m.role !== "user" && m.durationMs !== undefined ? { durationMs: m.durationMs } : {}),
					...(m.role === "toolResult"
						? {
								toolCallId: m.toolCallId,
								toolName: m.toolName,
								...(m.details !== undefined ? { details: m.details } : {}),
								isError: m.isError,
							}
						: {}),
				},
			}),
		);
		parentId = id;
	});

	const path = join(dir, `${opts.messages[0]?.timestamp ?? Date.now()}_${sessionId}.jsonl`);
	writeFileSync(path, `${lines.join("\n")}\n`);
	return { id: sessionId, path };
}

export function delegationSessionDirFor(
	dataDir: string,
	workspaceId: string,
	parentSessionId: string,
): string {
	return join(resolve(dataDir), "delegation", workspaceId, parentSessionId);
}

export function defaultSessionDirFor(agentDir: string, cwd: string): string {
	const resolvedCwd = resolve(cwd);
	const resolvedAgentDir = resolve(agentDir);
	const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(resolvedAgentDir, "sessions", safePath);
}
