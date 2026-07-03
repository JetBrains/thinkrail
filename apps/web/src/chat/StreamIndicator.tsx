import type { ChatTurn } from "./types";

/**
 * What the agent is doing *right now*, derived from the in-flight assistant turn so the loader can name the
 * phase instead of showing a bare spinner. `working` is the honest fallback for the beats where nothing is
 * visible yet: the gap between hitting send and the first token, and the pause between one assistant
 * message ending and the next starting.
 */
export type StreamPhase = "working" | "thinking" | "running-tool" | "writing";

export interface StreamStatus {
	phase: StreamPhase;
	/** The tool being executed, for the `running-tool` phase. */
	toolName?: string;
}

/**
 * Pure deriver (no store/transport) — reads the currently-streaming assistant turn's last content block to
 * decide the phase. Returns `working` when there is no in-flight turn yet (post-send gap) or it has produced
 * nothing. Kept independent of the reducer so it's unit-testable and reusable by any pi UI.
 */
export function streamStatus(turns: ChatTurn[], currentAssistantId: string | null): StreamStatus {
	// While a message streams, the turn named by `currentAssistantId` is authoritative. Between a message's
	// end and the next one starting — i.e. while its tools execute — no id is current, so the phase falls
	// back to the round's trailing assistant turn ("Running bash…" during the run, not a bare "Working…").
	// A user/system turn at the tail means a fresh post-send gap instead — no lingering stale phase.
	const lastTurn = turns.at(-1);
	const active =
		turns.find(
			(t): t is Extract<ChatTurn, { kind: "assistant" }> =>
				t.kind === "assistant" && t.id === currentAssistantId,
		) ?? (currentAssistantId == null && lastTurn?.kind === "assistant" ? lastTurn : undefined);
	const last = active?.message.content.at(-1);
	if (!last) return { phase: "working" };
	if (last.type === "toolCall") return { phase: "running-tool", toolName: last.name };
	if (last.type === "text") return last.text.trim() ? { phase: "writing" } : { phase: "working" };
	if (last.type === "thinking")
		return last.thinking.trim() ? { phase: "thinking" } : { phase: "working" };
	return { phase: "working" };
}

/** Human label for a phase. Exposed for tests + reuse. */
export function phaseLabel({ phase, toolName }: StreamStatus): string {
	switch (phase) {
		case "thinking":
			return "Thinking…";
		case "writing":
			return "Writing…";
		case "running-tool":
			return toolName ? `Running ${toolName}…` : "Running tool…";
		default:
			return "Working…";
	}
}

/** Three dots pulsing in a staggered wave — the "agent is active" affordance. `bg-current` inherits the
 * parent's (muted) text color, so it themes for free; the delays are Tailwind arbitrary utilities (not
 * inline styles), keeping the primitive token-only. */
function TypingDots() {
	return (
		<span className="flex items-center gap-0.5" aria-hidden="true">
			<span className="size-1.5 animate-pulse rounded-full bg-current" />
			<span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:200ms]" />
			<span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:400ms]" />
		</span>
	);
}

/**
 * The single, consistent streaming loader — a typing-dots wave + the current phase label. Presentational
 * and props-driven; `ChatView` computes the `StreamStatus` and renders this as the conversation footer so
 * it sits right where the next message will form. `data-testid`/`data-phase` make the loader lifecycle
 * assertable in e2e.
 */
export function StreamIndicator({ status }: { status: StreamStatus }) {
	return (
		<div
			data-testid="stream-indicator"
			data-phase={status.phase}
			role="status"
			aria-live="polite"
			className="flex items-center gap-sm py-xs text-muted text-xs"
		>
			<TypingDots />
			<span>{phaseLabel(status)}</span>
		</div>
	);
}
