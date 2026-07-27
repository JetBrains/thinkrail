import type { UserMessage } from "@thinkrail/contracts";
import {
	ChevronDown,
	ChevronRight,
	Clock,
	FileDiff,
	FileText,
	RotateCw,
	TriangleAlert,
	Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ActivityGroup } from "./ActivityGroup";
import { useFold } from "./foldState";
import { Markdown } from "./Markdown";
import type { ChatRow, TurnDividerData } from "./rows";
import { ToolCard } from "./ToolCard";
import { getToolChrome, getToolRenderer } from "./toolRegistry";
import { projectRelativePath } from "./tools/toolHelpers";

/**
 * Render one derived chat row (see `rows.ts` — the transcript renders rows, not raw turns, so routine
 * activity can fold across assistant-message boundaries). Presentational + props-driven (no
 * store/transport) so the renderers stay reusable; `ChatView` derives the rows from the store and feeds
 * them here. `onOpenSpec` / `onOpenChange` are the divider's two deep links ("N specs" → the Specs panel,
 * "N files changed" → the Changes panel), each taking the ONE path the user picked — supplied by the
 * integration layer, no-op defaults keep the primitives standalone.
 */
export function ChatTurnView({
	row,
	workspaceRoot,
	onOpenSpec,
	onOpenChange,
}: {
	row: ChatRow;
	workspaceRoot?: string | undefined;
	onOpenSpec?: ((path: string) => void) | undefined;
	onOpenChange?: ((path: string) => void) | undefined;
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
				<RetryIndicator
					source={row.source}
					attempt={row.attempt}
					maxAttempts={row.maxAttempts}
					delayMs={row.delayMs}
				/>
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
			return (
				<TurnDivider
					id={row.id}
					data={row.data}
					workspaceRoot={workspaceRoot}
					onOpenSpec={onOpenSpec ?? (() => {})}
					onOpenChange={onOpenChange ?? (() => {})}
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
	source,
	attempt,
	maxAttempts,
	delayMs,
}: {
	source: "turn" | "summarization";
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
			data-source={source}
			className="flex flex-col gap-xs rounded-[var(--radius-sm)] border border-border2 bg-elevated px-sm py-xs text-muted text-xs"
		>
			<span className="flex items-center gap-xs">
				<RotateCw className="size-3 shrink-0" />
				{source === "summarization" ? "Retrying summarization" : "Retrying"} ({attempt}/
				{maxAttempts})…
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
 * One kind of artifact a round produced: the paths, how to name them, and where a click sends the user.
 * `TurnDivider` builds one per side (specs / changed files) so the two are described once instead of being
 * spelled out in parallel across chip and list.
 */
interface ArtifactGroup {
	testid: string;
	icon: typeof FileText;
	paths: string[];
	/** Chip text for a count — each group owns its own singular/plural. */
	label: (count: number) => string;
	expanded: boolean;
	toggle: () => void;
	onOpen: (path: string) => void;
}

/**
 * One artifact chip of the round-end divider. A **single** artifact is an immediate deep link — one click
 * lands on the file, which is the common case and the whole point of the chip. **Several** turn it into a
 * disclosure instead: the round's set expands as a list right here in the transcript, and each row is the
 * same deep link. Why in the chat and not as a highlight over the panels: the set belongs to *this round*,
 * while the panels show *now* — a round from days ago would frame rows that have since moved on (or, for
 * Changes, are no longer in the diff at all). It also keeps the count honest — clicking "5 files changed"
 * can't silently surface just the first one. Fold state rides `useFold`, so it survives virtualization and
 * streaming re-derivation like every other fold in the transcript.
 */
function ArtifactChip({ group }: { group: ArtifactGroup }) {
	const { testid, icon: Icon, paths, label, expanded, toggle, onOpen } = group;
	const many = paths.length > 1;
	const first = paths[0];
	return (
		<button
			type="button"
			data-testid={testid}
			data-expanded={many && expanded ? true : undefined}
			aria-expanded={many ? expanded : undefined}
			onClick={() => {
				if (many) toggle();
				else if (first) onOpen(first);
			}}
			className="flex items-center gap-xs rounded-[var(--radius-sm)] px-xs text-primary hover:bg-hover"
		>
			<Icon className="size-3 shrink-0" />
			{label(paths.length)}
			{many ? (
				expanded ? (
					<ChevronDown className="size-3 shrink-0" />
				) : (
					<ChevronRight className="size-3 shrink-0" />
				)
			) : null}
		</button>
	);
}

/**
 * The expanded artifact set, listed under the divider rule — one deep-linking row per path. Paths render
 * worktree-relative (`projectRelativePath`, the same normalization the tool cards use), since pi reports a
 * `path` argument either way and an absolute one truncates to nothing useful.
 */
function ArtifactList({
	group,
	workspaceRoot,
}: {
	group: ArtifactGroup;
	workspaceRoot?: string | undefined;
}) {
	const { testid, icon: Icon, paths, onOpen } = group;
	return (
		<ul data-testid={`${testid}-list`} className="flex flex-col">
			{paths.map((path) => (
				<li key={path}>
					<button
						type="button"
						data-testid={`${testid}-list-item`}
						onClick={() => onOpen(path)}
						title={path}
						className="flex w-full items-center gap-xs rounded-[var(--radius-sm)] px-xs py-[2px] text-left hover:bg-hover"
					>
						<Icon className="size-3 shrink-0 text-hint" />
						<span className="min-w-0 flex-1 truncate text-muted">
							{projectRelativePath(path, workspaceRoot)}
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}

/**
 * A subtle round-end divider (rendered right when the turn finishes, below its "✓ Done" marker): tool-call
 * count, then the round's written artifacts as **two chips split the way the right panel is** — "N specs"
 * (deep-links the Specs panel, opening the rendered spec — via `onOpenSpec`) and "N files changed"
 * (deep-links the Changes panel to the file: flips to the tab and highlights its row, leaving the diff to an
 * explicit click — via `onOpenChange`) — and elapsed wall-clock. Each chip deep-links directly for a single
 * artifact and expands into a list for several (see `ArtifactChip`); `id` (the divider row's id) keys that
 * fold. Presentational — the store touches live in `ChatView`, which supplies both handlers. The data comes
 * from the pure `turnDivider` deriver in `rows.ts`, which owns the spec/code partition.
 */
export function TurnDivider({
	id,
	data,
	workspaceRoot,
	onOpenSpec,
	onOpenChange,
}: {
	id: string;
	data: TurnDividerData;
	workspaceRoot?: string | undefined;
	onOpenSpec: (path: string) => void;
	onOpenChange: (path: string) => void;
}) {
	const { elapsedMs, toolCount, specs, changedFiles } = data;
	// One fold per side, keyed off the divider row id — both called unconditionally (hook order) even when
	// the round wrote nothing of that kind.
	const [specsOpen, toggleSpecs] = useFold(`${id}:specs`);
	const [filesOpen, toggleFiles] = useFold(`${id}:files`);
	const sides: ArtifactGroup[] = [
		{
			testid: "turn-divider-specs",
			icon: FileText,
			paths: specs,
			label: (n) => `${n} ${n === 1 ? "spec" : "specs"}`,
			expanded: specsOpen,
			toggle: toggleSpecs,
			onOpen: onOpenSpec,
		},
		{
			testid: "turn-divider-files",
			icon: FileDiff,
			paths: changedFiles,
			label: (n) => `${n} ${n === 1 ? "file changed" : "files changed"}`,
			expanded: filesOpen,
			toggle: toggleFiles,
			onOpen: onOpenChange,
		},
	];
	const groups = sides.filter((group) => group.paths.length > 0);

	if (toolCount === 0 && groups.length === 0 && (elapsedMs == null || elapsedMs < 1000)) {
		// Nothing worth noting between these turns — just a hairline rule.
		return <div data-testid="turn-divider" className="my-sm h-px bg-border2" />;
	}
	return (
		<div data-testid="turn-divider" className="my-sm flex flex-col gap-xs text-hint text-xs">
			<div className="flex items-center gap-sm">
				<span className="h-px flex-1 bg-border2" />
				{toolCount > 0 ? (
					<span className="flex items-center gap-xs">
						<Wrench className="size-3 shrink-0" />
						{toolCount} {toolCount === 1 ? "tool call" : "tool calls"}
					</span>
				) : null}
				{groups.map((group) => (
					<ArtifactChip key={group.testid} group={group} />
				))}
				{elapsedMs != null && elapsedMs >= 1000 ? (
					<span className="flex items-center gap-xs">
						<Clock className="size-3 shrink-0" />
						{formatElapsed(elapsedMs)}
					</span>
				) : null}
				<span className="h-px flex-1 bg-border2" />
			</div>
			{groups
				.filter((group) => group.paths.length > 1 && group.expanded)
				.map((group) => (
					<ArtifactList key={group.testid} group={group} workspaceRoot={workspaceRoot} />
				))}
		</div>
	);
}
