import type { AssistantMessage, UserMessage } from "@thinkrail-pi/contracts";
import { Brain, ChevronRight, Clock, FileDiff, RotateCw, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";
import { strArg } from "./tools/toolHelpers";
import type { ChatTurn, ToolResultState } from "./types";

/**
 * Render a chat turn. Presentational + props-driven (no store/transport) so the renderers stay reusable;
 * `ChatView` is the app-integration layer that feeds these from the store. `toolResults` pairs a tool
 * call (inside an assistant turn) with its output by `toolCallId`.
 */
export function ChatTurnView({
	turn,
	toolResults,
}: {
	turn: ChatTurn;
	toolResults: Record<string, ToolResultState>;
}) {
	switch (turn.kind) {
		case "user":
			return <UserTurn message={turn.message} />;
		case "assistant":
			return (
				<AssistantTurn
					message={turn.message}
					streaming={turn.streaming}
					toolResults={toolResults}
				/>
			);
		case "system":
			return <SystemTurn text={turn.text} />;
		case "retry":
			return (
				<RetryIndicator
					attempt={turn.attempt}
					maxAttempts={turn.maxAttempts}
					delayMs={turn.delayMs}
				/>
			);
		default:
			return null;
	}
}

function userText(content: UserMessage["content"]): string {
	if (typeof content === "string") return content;
	return content
		.filter((c) => c.type === "text")
		.map((c) => c.text)
		.join("");
}

function UserTurn({ message }: { message: UserMessage }) {
	return (
		<div data-testid="chat-message" data-role="user" className="flex justify-end">
			<div className="max-w-[85%] whitespace-pre-wrap rounded-[var(--radius-md)] border border-[var(--bubble-user-border)] bg-[var(--bubble-user-bg)] px-md py-sm text-sm text-text">
				{userText(message.content)}
			</div>
		</div>
	);
}

/** Walk the assistant message's content blocks IN ORDER: text → markdown, thinking → block, toolCall → card. */
function AssistantTurn({
	message,
	streaming,
	toolResults,
}: {
	message: AssistantMessage;
	streaming: boolean;
	toolResults: Record<string, ToolResultState>;
}) {
	// While the model is still thinking and no answer text has arrived, the thinking block expands to let
	// the user watch live; once any answer text exists it folds away so the answer is the focus.
	const hasAnswerText = message.content.some((b) => b.type === "text" && b.text.trim().length > 0);
	const thinkingActive = streaming && !hasAnswerText;
	return (
		<div
			data-testid="chat-message"
			data-role="assistant"
			className="flex flex-col gap-sm text-sm text-text"
		>
			{message.content.map((block, index) => {
				if (block.type === "toolCall") {
					return (
						<ToolCard
							key={block.id}
							toolName={block.name}
							args={block.arguments}
							tool={toolResults[block.id]}
						/>
					);
				}
				// Text/thinking blocks have no id; their array position is stable (pi appends, never reorders),
				// so the index is a correct, safe key here.
				const key = `${block.type}-${index}`;
				if (block.type === "text") {
					return block.text ? <Markdown key={key} text={block.text} /> : null;
				}
				if (block.type === "thinking") {
					return block.thinking ? (
						<ThinkingBlock key={key} text={block.thinking} active={thinkingActive} />
					) : null;
				}
				return null;
			})}
		</div>
	);
}

/** Compact a character count: 1234 → "1.2k", 980 → "980". */
function formatChars(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/**
 * The model's reasoning. Auto-expands while actively thinking (no answer yet) and auto-collapses once the
 * answer begins — unless the user has manually toggled it, in which case their choice sticks for the turn.
 */
function ThinkingBlock({ text, active }: { text: string; active: boolean }) {
	const [expanded, setExpanded] = useState(active);
	const userToggled = useRef(false);

	useEffect(() => {
		if (!userToggled.current) setExpanded(active);
	}, [active]);

	const toggle = () => {
		userToggled.current = true;
		setExpanded((e) => !e);
	};

	return (
		<div
			data-testid="thinking-block"
			data-expanded={expanded}
			className="rounded-[var(--radius-sm)] border border-border2 bg-elevated px-sm py-xs text-muted text-xs"
		>
			<button
				type="button"
				onClick={toggle}
				className="flex w-full cursor-pointer select-none items-center gap-xs text-left"
			>
				<Brain className="size-3.5 shrink-0" />
				<ChevronRight
					className={`size-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
				/>
				<span>{expanded ? "Thinking" : `Thinking (${formatChars(text.length)} chars)`}</span>
			</button>
			{expanded ? <div className="mt-xs whitespace-pre-wrap">{text}</div> : null}
		</div>
	);
}

function SystemTurn({ text }: { text: string }) {
	return (
		<div data-testid="chat-message" data-role="system" className="text-center text-hint text-xs">
			{text}
		</div>
	);
}

/**
 * The live auto-retry back-off: attempt count + a bar that drains over `delayMs`. The fill flips from full
 * to empty on the next frame so the CSS width transition runs the countdown; only the (dynamic) transition
 * duration is an inline style — color/width are token utilities.
 */
function RetryIndicator({
	attempt,
	maxAttempts,
	delayMs,
}: {
	attempt: number;
	maxAttempts: number;
	delayMs: number;
}) {
	const [draining, setDraining] = useState(false);
	useEffect(() => {
		const raf = requestAnimationFrame(() => setDraining(true));
		return () => cancelAnimationFrame(raf);
	}, []);

	return (
		<div
			data-testid="retry-indicator"
			className="flex flex-col gap-xs rounded-[var(--radius-sm)] border border-border2 bg-elevated px-sm py-xs text-muted text-xs"
		>
			<span className="flex items-center gap-xs">
				<RotateCw className="size-3 shrink-0" />
				Retrying ({attempt}/{maxAttempts})…
			</span>
			<div className="h-1 w-full overflow-hidden rounded-full bg-border2">
				<div
					className={`h-full bg-primary transition-[width] ease-linear ${draining ? "w-0" : "w-full"}`}
					style={{ transitionDuration: `${delayMs}ms` }}
				/>
			</div>
		</div>
	);
}

/** Orientation metadata for the round-end divider (derived in the view, not the reducer). */
export interface TurnDividerData {
	/** Wall-clock from the round's user turn to its end (agent_end, or the last assistant reply), or null. */
	elapsedMs: number | null;
	/** Tool calls made by the assistant turn(s) in this round. */
	toolCount: number;
	/** Distinct files written/edited by those tool calls (worktree-relative or absolute, as pi reported). */
	changedFiles: string[];
}

/**
 * Derive the divider that closes the round *ending* at `endIndex` (its "✓ Done" marker, or its last
 * assistant turn when hydrated): the round's tool calls + edited/written files, plus the elapsed wall-clock
 * from the round's user turn to its end. Anchored at the round end (not the next user turn) so the summary
 * appears the instant the turn finishes. The end time comes from the "✓ Done" marker's `endedAt` when
 * present (live), else the last assistant message's timestamp (hydrated) — stable either way, so the number
 * never jumps when a follow-up arrives. Returns null when there is no user turn starting the round. Pure.
 */
export function turnDivider(turns: ChatTurn[], endIndex: number): TurnDividerData | null {
	let userIdx = -1;
	for (let i = endIndex; i >= 0; i--) {
		if (turns[i]?.kind === "user") {
			userIdx = i;
			break;
		}
	}
	if (userIdx < 0) return null;

	let toolCount = 0;
	const changedFiles: string[] = [];
	let endMs: number | null = null;
	for (let i = userIdx + 1; i <= endIndex; i++) {
		const turn = turns[i];
		if (turn?.kind === "assistant") {
			if (turn.message.timestamp) endMs = turn.message.timestamp;
			for (const block of turn.message.content) {
				if (block.type !== "toolCall") continue;
				toolCount++;
				if (block.name === "edit" || block.name === "write") {
					const path = strArg(block.arguments, "path");
					if (path && !changedFiles.includes(path)) changedFiles.push(path);
				}
			}
		} else if (turn?.kind === "system" && turn.endedAt != null) {
			endMs = turn.endedAt; // the live "✓ Done" marker carries the precise turn-end time
		}
	}

	const user = turns[userIdx];
	const startMs = user?.kind === "user" ? user.message.timestamp : null;
	const elapsedMs = startMs != null && endMs != null ? endMs - startMs : null;

	return { elapsedMs, toolCount, changedFiles };
}

/** "1m 12s" / "45s" from a millisecond span. */
function formatElapsed(ms: number): string {
	const totalSec = Math.round(ms / 1000);
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * A subtle round-end divider (rendered right when the turn finishes, below its "✓ Done" marker): tool-call
 * count, a clickable "N files changed" chip (opens those files in the Changes/diff panel via
 * `onOpenChanges`), and elapsed wall-clock. Presentational — the store touch lives in `ChatView`, which
 * supplies `onOpenChanges`.
 */
export function TurnDivider({
	data,
	onOpenChanges,
}: {
	data: TurnDividerData;
	onOpenChanges: (paths: string[]) => void;
}) {
	const { elapsedMs, toolCount, changedFiles } = data;
	if (toolCount === 0 && changedFiles.length === 0 && (elapsedMs == null || elapsedMs < 1000)) {
		// Nothing worth noting between these turns — just a hairline rule.
		return <div data-testid="turn-divider" className="my-sm h-px bg-border2" />;
	}
	return (
		<div data-testid="turn-divider" className="my-sm flex items-center gap-sm text-hint text-xs">
			<span className="h-px flex-1 bg-border2" />
			{toolCount > 0 ? (
				<span className="flex items-center gap-xs">
					<Wrench className="size-3 shrink-0" />
					{toolCount} {toolCount === 1 ? "tool call" : "tool calls"}
				</span>
			) : null}
			{changedFiles.length > 0 ? (
				<button
					type="button"
					data-testid="turn-divider-files"
					onClick={() => onOpenChanges(changedFiles)}
					className="flex items-center gap-xs rounded-[var(--radius-sm)] px-xs text-primary hover:bg-hover"
				>
					<FileDiff className="size-3 shrink-0" />
					{changedFiles.length} {changedFiles.length === 1 ? "file changed" : "files changed"}
				</button>
			) : null}
			{elapsedMs != null && elapsedMs >= 1000 ? (
				<span className="flex items-center gap-xs">
					<Clock className="size-3 shrink-0" />
					{formatElapsed(elapsedMs)}
				</span>
			) : null}
			<span className="h-px flex-1 bg-border2" />
		</div>
	);
}
