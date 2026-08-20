import type { ChatTurn } from "./types";

export type StreamPhase = "working" | "thinking" | "running-tool" | "writing" | "compacting";

export interface StreamStatus {
	phase: StreamPhase;
	toolName?: string;
}

export function streamStatus(turns: ChatTurn[], currentAssistantId: string | null): StreamStatus {
	const lastTurn = turns.at(-1);
	if (lastTurn?.kind === "compaction" && lastTurn.status === "running")
		return { phase: "compacting" };
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

export function phaseLabel({ phase, toolName }: StreamStatus): string {
	switch (phase) {
		case "thinking":
			return "Thinking…";
		case "writing":
			return "Writing…";
		case "running-tool":
			return toolName ? `Running ${toolName}…` : "Running tool…";
		case "compacting":
			return "Compacting context…";
		default:
			return "Working…";
	}
}

function TypingDots() {
	return (
		<span className="flex items-center gap-0.5" aria-hidden="true">
			<span className="size-1.5 animate-pulse rounded-full bg-current" />
			<span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:200ms]" />
			<span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:400ms]" />
		</span>
	);
}

export function StreamIndicator({ status }: { status: StreamStatus }) {
	return (
		<div
			data-testid="stream-indicator"
			data-phase={status.phase}
			role="status"
			aria-live="polite"
			className="flex items-center gap-sm py-xs text-text-muted tr-text-metadata"
		>
			<TypingDots />
			<span>{phaseLabel(status)}</span>
		</div>
	);
}
