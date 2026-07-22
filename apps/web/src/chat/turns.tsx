import type { UserMessage } from "@thinkrail/contracts";
import { Check, Clock, Copy, FileDiff, RotateCw, TriangleAlert, Wrench } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ActivityGroup } from "./ActivityGroup";
import { useFold } from "./foldState";
import { Markdown } from "./Markdown";
import { MESSAGE_COLLAPSE_LIMIT, shouldCollapseMessage } from "./messageCollapse";
import type { ChatRow, TurnDividerData } from "./rows";
import { ToolCard } from "./ToolCard";
import { getToolChrome, getToolRenderer } from "./toolRegistry";

/**
 * Render one derived chat row (see `rows.ts` — the transcript renders rows, not raw turns, so routine
 * activity can fold across assistant-message boundaries). Presentational + props-driven (no
 * store/transport) so the renderers stay reusable; `ChatView` derives the rows from the store and feeds
 * them here. `onOpenChanges` is the divider's "files changed" deep link — supplied by the integration
 * layer, a no-op default keeps the primitives standalone.
 */
export function ChatTurnView({
	row,
	workspaceRoot,
	onOpenChanges,
	isLastMessage = false,
}: {
	row: ChatRow;
	workspaceRoot?: string | undefined;
	onOpenChanges?: ((paths: string[]) => void) | undefined;
	/** True for the thread's last text message (user prompt or agent response) — it never collapses. */
	isLastMessage?: boolean;
}) {
	switch (row.kind) {
		case "user":
			return <UserTurn message={row.message} id={row.id} isLast={isLastMessage} />;
		case "system":
			return <SystemTurn text={row.text} />;
		case "error":
			return <ErrorTurn text={row.text} />;
		case "retry":
			return (
				<RetryIndicator attempt={row.attempt} maxAttempts={row.maxAttempts} delayMs={row.delayMs} />
			);
		case "markdown":
			// Agent message content is capped at 85% of the chat column, left-aligned (slack on the right) —
			// the mirror of the user bubble's `max-w-[85%]`. Applies to text, tool, and activity rows.
			return (
				<div
					data-testid="chat-message"
					data-role="assistant"
					className="max-w-[85%] text-sm text-text"
				>
					<CollapsibleMessage id={row.id} text={row.text} isLast={isLastMessage}>
						{(shown) => <Markdown text={shown} />}
					</CollapsibleMessage>
				</div>
			);
		case "tool":
			return (
				<div className="max-w-[85%]">
					<ToolRow row={row} workspaceRoot={workspaceRoot} />
				</div>
			);
		case "activity":
			return (
				<div className="max-w-[85%]">
					<ActivityGroup
						id={row.id}
						steps={row.steps}
						live={row.live}
						workspaceRoot={workspaceRoot}
					/>
				</div>
			);
		case "divider":
			return <TurnDivider data={row.data} onOpenChanges={onOpenChanges ?? (() => {})} />;
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

function UserTurn({ message, id, isLast }: { message: UserMessage; id: string; isLast: boolean }) {
	const text = userText(message.content);
	return (
		<div data-testid="chat-message" data-role="user" className="flex justify-end">
			{/* `group` + `relative`: the copy button is absolutely placed 6px below the bubble, right-aligned to
			    its edge, revealed on hover — absolute so it sits in the existing gap below without reflowing the
			    layout (the between-message spacing is unchanged). */}
			<div className="group relative max-w-[85%]">
				<div className="whitespace-pre-wrap rounded-[var(--radius-md)] border border-[var(--bubble-user-border)] bg-[var(--bubble-user-bg)] px-md py-sm text-sm text-text">
					<CollapsibleMessage id={id} text={text} isLast={isLast}>
						{(shown) => shown}
					</CollapsibleMessage>
				</div>
				<CopyMessageButton text={text} />
			</div>
		</div>
	);
}

/**
 * Copy a user message's text to the clipboard — the shared copy affordance (Copy icon → a green Check for
 * ~1.5s), reused from `JetBrainsAiCard`'s `CopyableCommand`. Hidden until the message is hovered
 * (`group-hover`); absolutely positioned below the bubble (right-aligned, 6px gap) so revealing it never
 * reflows the transcript.
 */
function CopyMessageButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard unavailable — the message text stays selectable.
		}
	};
	return (
		<button
			type="button"
			data-testid="copy-user-message"
			aria-label="Copy message"
			title="Copy"
			onClick={() => void copy()}
			className="absolute top-full right-0 mt-[6px] flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-muted opacity-0 outline-none transition hover:bg-hover hover:text-text focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100"
		>
			{copied ? <Check className="size-3.5 text-green" /> : <Copy className="size-3.5" />}
		</button>
	);
}

/**
 * Collapse a long history message behind an Expand control (reusing the `Collapsible` toggle styling).
 * The last message and any message ≤ {@link MESSAGE_COLLAPSE_LIMIT} render in full, unwrapped (no layout
 * change). Otherwise the first ~limit chars show with an Expand/Collapse toggle; the expanded state is
 * per-message client view state via `useFold(id)` (survives virtualization while the thread is open,
 * never sent to the server). `children(shown)` renders the (possibly-truncated) text — plain for a user
 * bubble, `<Markdown>` for an assistant response.
 */
function CollapsibleMessage({
	id,
	text,
	isLast,
	children,
}: {
	id: string;
	text: string;
	isLast: boolean;
	children: (shown: string) => ReactNode;
}) {
	const [expanded, toggle] = useFold(id);
	if (!shouldCollapseMessage(text, isLast)) return <>{children(text)}</>;
	const shown = expanded ? text : `${text.slice(0, MESSAGE_COLLAPSE_LIMIT)}…`;
	return (
		<div className="flex flex-col gap-xs">
			{children(shown)}
			<button
				type="button"
				data-testid="message-collapse-toggle"
				aria-expanded={expanded}
				onClick={toggle}
				className="self-start text-primary text-xs hover:underline"
			>
				{expanded ? "Collapse" : "Expand"}
			</button>
		</div>
	);
}

/**
 * A primary tool call, framed by its registered chrome. `"bare"` tools (e.g. the inline
 * `ask_user_question` questionnaire) own their whole frame and render full-width without the collapsible
 * header; everything else goes through the shared {@link ToolCard} (collapsed unless `defaultExpanded`;
 * errors auto-expand). A call on a dead message (aborted/errored — pi never executes those calls) renders
 * as errored rather than staying running/interactive forever.
 */
function ToolRow({
	row,
	workspaceRoot,
}: {
	row: Extract<ChatRow, { kind: "tool" }>;
	workspaceRoot?: string | undefined;
}) {
	if (getToolChrome(row.toolName) === "bare") {
		const Renderer = getToolRenderer(row.toolName);
		return (
			<div className="text-sm text-text">
				<Renderer
					toolCallId={row.toolCallId}
					toolName={row.toolName}
					args={row.args}
					result={row.tool?.raw}
					status={row.tool?.status ?? (row.dead ? "error" : "running")}
					workspaceRoot={workspaceRoot}
					streaming={row.streaming}
				/>
			</div>
		);
	}
	return (
		<ToolCard
			toolCallId={row.toolCallId}
			toolName={row.toolName}
			args={row.args}
			tool={row.tool}
			dead={row.dead}
			streaming={row.streaming}
			workspaceRoot={workspaceRoot}
		/>
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
 * A failure notice: the run ended in a provider/model error, or the host rejected a send (bad model,
 * missing API key, …). Kept visible (never folded) so a failed turn never looks like nothing happened.
 */
function ErrorTurn({ text }: { text: string }) {
	return (
		<div
			data-testid="chat-message"
			data-role="error"
			className="flex items-start gap-sm rounded-[var(--radius-md)] border border-red/40 bg-red/10 px-md py-sm text-red text-sm"
		>
			<TriangleAlert className="mt-[2px] size-4 shrink-0" />
			<span className="min-w-0 whitespace-pre-wrap break-words">{text}</span>
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

/** "1m 12s" / "45s" from a millisecond span. */
function formatElapsed(ms: number): string {
	const totalSec = Math.round(ms / 1000);
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * The round-end completion line (rendered the instant the turn finishes): a circled accent "Done" badge,
 * the divider rule, then the metrics — tool-call count, elapsed wall-clock, and a clickable "N files
 * changed" chip (opens those files in the Changes/diff panel via `onOpenChanges`). It replaces the old
 * standalone "✓ Done" line (that `system` marker no longer renders as its own row; see `rows.ts`). Presentational — the store touch lives in `ChatView`, which
 * supplies `onOpenChanges`. The data comes from the pure `turnDivider` deriver in `rows.ts`.
 */
export function TurnDivider({
	data,
	onOpenChanges,
}: {
	data: TurnDividerData;
	onOpenChanges: (paths: string[]) => void;
}) {
	const { elapsedMs, toolCount, changedFiles } = data;
	// One completion line: a circled accent "Done" badge (left), the divider rule filling the middle, and
	// the metrics (right) — tool calls · time · files changed. Metrics render only when there's something
	// worth noting; the badge + rule always show so a finished turn is always marked.
	return (
		<div data-testid="turn-divider" className="flex items-center gap-sm text-hint text-xs">
			<span
				data-testid="turn-done"
				className="flex shrink-0 items-center gap-xs rounded-full bg-primary/15 px-sm py-0.5 font-medium text-primary"
			>
				<Check className="size-3 shrink-0" />
				Done
			</span>
			<span className="h-px flex-1 bg-border2" />
			{toolCount > 0 ? (
				<span className="flex items-center gap-xs">
					<Wrench className="size-3 shrink-0" />
					{toolCount} {toolCount === 1 ? "tool call" : "tool calls"}
				</span>
			) : null}
			{elapsedMs != null && elapsedMs >= 1000 ? (
				<span className="flex items-center gap-xs">
					<Clock className="size-3 shrink-0" />
					{formatElapsed(elapsedMs)}
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
		</div>
	);
}
