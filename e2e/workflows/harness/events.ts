// The observation channel — everything a scenario knows about what the agent did comes through here.
// One process-wide setSessionPublisher subscriber BUFFERS ALL EVENTS PER SESSION UNCONDITIONALLY, so a
// `captureEvents()` call after `startSession()` can never miss early events — it returns a live view.
import "./env";
import type { PiEvent } from "@thinkrail/contracts";
import { setSessionPublisher } from "@thinkrail/server/agent";

export interface CapturedToolCall {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	/** Filled when the matching tool_execution_end arrives. */
	result?: unknown;
	isError?: boolean;
}

type Listener = () => void;

export class EventLog {
	readonly events: PiEvent[] = [];
	private listeners = new Set<Listener>();

	push(event: PiEvent): void {
		this.events.push(event);
		for (const listener of [...this.listeners]) listener();
	}

	/** Subscribe to "the log grew" — the primitive signals/dialog build on. Returns unsubscribe. */
	onGrow(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Tool calls in execution order (args are complete at tool_execution_start). */
	toolCalls(name?: string): CapturedToolCall[] {
		const calls: CapturedToolCall[] = [];
		const byId = new Map<string, CapturedToolCall>();
		for (const event of this.events) {
			if (event.type === "tool_execution_start") {
				const call: CapturedToolCall = {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: (event.args ?? {}) as Record<string, unknown>,
				};
				calls.push(call);
				byId.set(event.toolCallId, call);
			} else if (event.type === "tool_execution_end") {
				const call = byId.get(event.toolCallId);
				if (call) {
					call.result = event.result;
					call.isError = event.isError;
				}
			}
		}
		return name ? calls.filter((c) => c.toolName === name) : calls;
	}

	/**
	 * Skill names loaded so far, in order — pi's skill-load mechanism is the agent `read`ing the skill's
	 * `…/skills/<name>/SKILL.md`, so a read-tool call on that path IS the deterministic load signal.
	 */
	skillReads(): string[] {
		const names: string[] = [];
		for (const call of this.toolCalls("read")) {
			const path = String(call.args.path ?? call.args.file_path ?? "");
			const match = path.match(/\/skills\/([^/]+)\/SKILL\.md$/);
			if (match?.[1] && !names.includes(match[1])) names.push(match[1]);
		}
		return names;
	}

	/** Completed assistant message texts, in order. */
	assistantTexts(): string[] {
		const texts: string[] = [];
		for (const event of this.events) {
			if (event.type !== "message_end") continue;
			const message = event.message as { role?: string; content?: unknown };
			if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
			const text = message.content
				.filter((c: { type?: string }) => c.type === "text")
				.map((c: { text?: string }) => c.text ?? "")
				.join("");
			if (text.trim()) texts.push(text);
		}
		return texts;
	}

	/** Completed agent turns so far (turn_end count) — the watchdog's cheapest budget meter. */
	turnCount(): number {
		return this.events.filter((e) => e.type === "turn_end").length;
	}

	/** Resolve when `predicate(this)` holds (checked now + on every growth). Rejects on timeout with the tail. */
	waitFor(predicate: (log: EventLog) => boolean, timeoutMs: number): Promise<void> {
		return new Promise((resolve, reject) => {
			if (predicate(this)) return resolve();
			const unsubscribe = this.onGrow(() => {
				if (!predicate(this)) return;
				cleanup();
				resolve();
			});
			const timer = setTimeout(() => {
				cleanup();
				reject(new Error(`waitFor timed out after ${timeoutMs}ms.\nLog tail:\n${this.tail()}`));
			}, timeoutMs);
			const cleanup = (): void => {
				clearTimeout(timer);
				unsubscribe();
			};
		});
	}

	/** Compact rendering for the judge / user simulator / watchdog — roles, texts, tool calls, results. */
	renderTranscript(maxResultChars = 400): string {
		const lines: string[] = [];
		for (const event of this.events) {
			if (event.type === "message_end") {
				const message = event.message as { role?: string; content?: unknown };
				if (!Array.isArray(message.content)) {
					if (typeof message.content === "string" && message.content.trim())
						lines.push(`[${message.role}] ${message.content}`);
					continue;
				}
				for (const block of message.content as Array<Record<string, unknown>>) {
					if (block.type === "text" && String(block.text ?? "").trim())
						lines.push(`[${message.role}] ${block.text}`);
					else if (block.type === "toolCall")
						lines.push(
							`[${message.role}] → tool ${block.name}(${truncate(JSON.stringify(block.arguments), 300)})`,
						);
				}
			} else if (event.type === "tool_execution_end") {
				lines.push(
					`[tool ${event.toolName}${event.isError ? " ERROR" : ""}] ${truncate(renderResult(event.result), maxResultChars)}`,
				);
			}
		}
		return lines.join("\n");
	}

	/** The last few events, for timeout/failure diagnostics. */
	tail(count = 12): string {
		return this.events
			.slice(-count)
			.map((e) => truncate(JSON.stringify(e), 200))
			.join("\n");
	}
}

function renderResult(result: unknown): string {
	if (result == null) return "";
	if (typeof result === "string") return result;
	const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
	if (Array.isArray(content))
		return content
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("");
	return JSON.stringify(result);
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

const logs = new Map<string, EventLog>();

// Installed once at module load: buffer every session's events from the moment it exists.
setSessionPublisher((payload) => {
	let log = logs.get(payload.sessionId);
	if (!log) {
		log = new EventLog();
		logs.set(payload.sessionId, log);
	}
	log.push(payload.event);
});

/** The (live) event log for a session — a view over the unconditional buffer. */
export function captureEvents(sessionId: string): EventLog {
	let log = logs.get(sessionId);
	if (!log) {
		log = new EventLog();
		logs.set(sessionId, log);
	}
	return log;
}
