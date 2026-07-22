import type { UserMessage } from "@thinkrail/contracts";
import { Clock, FileDiff, RotateCw, TriangleAlert, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { ActivityGroup } from "./ActivityGroup";
import { Markdown } from "./Markdown";
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
}: {
	row: ChatRow;
	workspaceRoot?: string | undefined;
	onOpenChanges?: ((paths: string[]) => void) | undefined;
}) {
	switch (row.kind) {
		case "user":
			return <UserTurn message={row.message} />;
		case "system":
			return <SystemTurn text={row.text} />;
		case "error":
			return <ErrorTurn text={row.text} />;
		case "retry":
			return (
				<RetryIndicator attempt={row.attempt} maxAttempts={row.maxAttempts} delayMs={row.delayMs} />
			);
		case "markdown":
			return (
				<div data-testid="chat-message" data-role="assistant" className="text-sm text-text">
					<Markdown text={row.text} />
				</div>
			);
		case "tool":
			return <ToolRow row={row} workspaceRoot={workspaceRoot} />;
		case "activity":
			return (
				<ActivityGroup
					id={row.id}
					steps={row.steps}
					live={row.live}
					workspaceRoot={workspaceRoot}
				/>
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

function UserTurn({ message }: { message: UserMessage }) {
	return (
		<div data-testid="chat-message" data-role="user" className="flex justify-end">
			<div className="max-w-[85%] whitespace-pre-wrap rounded-[var(--radius-md)] border border-[var(--bubble-user-border)] bg-[var(--bubble-user-bg)] px-md py-sm text-sm text-text">
				{userText(message.content)}
			</div>
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
 * A subtle round-end divider (rendered right when the turn finishes, below its "✓ Done" marker): tool-call
 * count, a clickable "N files changed" chip (deep-links the Changes panel to the file — flips to the tab
 * and highlights its row, leaving the diff to an explicit click — via `onOpenChanges`), and elapsed
 * wall-clock. Presentational — the store touch lives in `ChatView`, which supplies `onOpenChanges`. The
 * data comes from the pure `turnDivider` deriver in `rows.ts`.
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
