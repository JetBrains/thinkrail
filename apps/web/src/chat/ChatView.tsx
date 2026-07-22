import type {
	AskUserQuestionResult,
	ImageContent,
	ThinkingLevel,
	WireModel,
} from "@thinkrail/contracts";
import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Popover, PopoverAnchor, PopoverTrigger } from "@/components/ui/popover";
import { EMPTY_RUNTIME, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { AskStatesContext, deriveAskStates } from "./askState";
import { type ChatActions, ChatActionsContext } from "./ChatActions";
import { ChatHeader } from "./ChatHeader";
import { ChatPlanContent, ChatPlanStripContent } from "./ChatPlan";
import { Composer, type MentionCandidate, type SubmitBehavior } from "./Composer";
import { ExtUiDialog } from "./ExtUiDialog";
import { type ChatRow, deriveRows } from "./rows";
import { isSkillPath, SkillsDialog } from "./SkillsDialog";
import { StreamIndicator, type StreamStatus, streamStatus } from "./StreamIndicator";
import "./tools/register"; // side-effect: register the built-in pi tool renderers (bash/read/edit/write)
import { ChatTurnView } from "./turns";
import { useChatScroll } from "./useChatScroll";
import { useChatTodos } from "./useChatTodos";

/** Context threaded to the Virtuoso footer so the streaming loader lives at the end of the conversation. */
type ChatListContext = { status: StreamStatus | null };

/** The conversation footer: the streaming loader, or nothing when idle. Stable module-scope component so
 * Virtuoso never remounts it; its data arrives via `context`, not closure. */
function StreamFooter({ context }: { context: ChatListContext }) {
	if (!context.status) return null;
	return (
		<div className="mx-auto max-w-3xl px-md pb-sm">
			<StreamIndicator status={context.status} />
		</div>
	);
}

const CHAT_LIST_COMPONENTS = { Footer: StreamFooter };

/**
 * One chat session as a center tab — the app-integration layer that wires the store + transport to the
 * presentational chat primitives (header status/stats, turn list, composer pickers, extension-UI dialog).
 * The renderers stay store-free so they're reusable; this is the only file in `chat/` that touches
 * store/transport.
 */
export default function ChatView({
	sessionId,
	workspaceId,
}: {
	sessionId: string;
	workspaceId: string;
}) {
	// This tab's runtime — zustand only re-renders when *this* session's slice ref changes, so a background
	// chat streaming into its own runtime never re-renders the foreground one.
	const runtime = useAppStore((s) => s.sessions[sessionId]) ?? EMPTY_RUNTIME;
	const models = useAppStore((s) => s.models);
	// This chat's owning project (workspaces are keyed by project) — for the Skills manager's trust ops.
	const projectId = useAppStore(
		(s) =>
			Object.values(s.workspaces)
				.flat()
				.find((w) => w.id === workspaceId)?.projectId ?? null,
	);
	const [skillsOpen, setSkillsOpen] = useState(false);
	// Auto-detect: the worktree watcher's fs nudge flags skills stale (the session loaded an older set) when
	// a skill dir changes on disk — a pull/branch/edit. Reload is manual, so this only prompts.
	const fsSignal = useAppStore((s) => s.fsChangesByWorkspace[workspaceId]);
	const [skillsStale, setSkillsStale] = useState(false);
	const lastSkillTick = useRef(0);
	useEffect(() => {
		if (!fsSignal || fsSignal.tick === lastSkillTick.current) return;
		lastSkillTick.current = fsSignal.tick;
		if (fsSignal.truncated || fsSignal.paths.some(isSkillPath)) setSkillsStale(true);
	}, [fsSignal]);
	const workspaceRoot = useAppStore((s) => {
		for (const workspaces of Object.values(s.workspaces)) {
			const workspace = workspaces.find((w) => w.id === workspaceId);
			if (workspace) return workspace.worktreePath;
		}
		return undefined;
	});
	const {
		turns,
		toolResults,
		isStreaming,
		currentAssistantId,
		stats,
		commands,
		draft,
		pendingExtUi,
		extUiStatus,
		extUiWidget,
		model: currentModel,
		thinkingLevel,
	} = runtime;

	// The transcript renders derived rows, not raw turns: routine activity folds across assistant-message
	// boundaries, so the row model is re-derived per snapshot (pure + memoized; stable row ids keep
	// Virtuoso keys and fold state steady while streaming).
	const rows = useMemo(
		() => deriveRows(turns, toolResults, isStreaming),
		[turns, toolResults, isStreaming],
	);

	// The streaming loader lives as the list footer (so it forms where the next message will). Suppressed
	// during a retry countdown, which renders its own indicator turn. `working` covers the post-send gap.
	const listContext = useMemo<ChatListContext>(() => {
		const last = turns[turns.length - 1];
		const status =
			isStreaming && last?.kind !== "retry" ? streamStatus(turns, currentAssistantId) : null;
		return { status };
	}, [turns, isStreaming, currentAssistantId]);

	const [mentionQuery, setMentionQuery] = useState<string | null>(null);
	const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
	// The chat's TODO plan, surfaced inline via a header strip that opens a popup over the chat (SPEC §Chat TODO plan).
	const plan = useChatTodos(workspaceId, sessionId);
	const [planOpen, setPlanOpen] = useState(false);

	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const { followOutput, handleAtBottom, showScrollButton, scrollToBottom, containerProps } =
		useChatScroll(virtuosoRef);

	// Models are global to the host — fetch once, then every chat's picker shares them.
	useEffect(() => {
		if (models.length > 0) return;
		getTransport()
			.request("model.list", {})
			.then((m) => useAppStore.getState().setModels(m))
			.catch(() => {});
	}, [models.length]);

	// The skill catalog is per-session; load it when the chat opens.
	useEffect(() => {
		getTransport()
			.request("session.getCommands", { sessionId })
			.then((c) => useAppStore.getState().setCommands(sessionId, c))
			.catch(() => {});
	}, [sessionId]);

	// Refresh token/cost stats when a turn starts and ends (display only — `pi` owns the numbers).
	// biome-ignore lint/correctness/useExhaustiveDependencies: `isStreaming` is the refetch trigger, not read
	useEffect(() => {
		getTransport()
			.request("session.getStats", { sessionId })
			.then((st) => useAppStore.getState().setStats(sessionId, st))
			.catch(() => {});
	}, [sessionId, isStreaming]);

	// `@`-mention completion: read the worktree directory implied by the token, filter by its basename.
	useEffect(() => {
		if (mentionQuery === null) {
			setMentionCandidates([]);
			return;
		}
		const slash = mentionQuery.lastIndexOf("/");
		const dir = slash >= 0 ? mentionQuery.slice(0, slash) : "";
		const prefix = (slash >= 0 ? mentionQuery.slice(slash + 1) : mentionQuery).toLowerCase();
		let cancelled = false;
		const timer = setTimeout(() => {
			getTransport()
				.request("fs.readDir", { workspaceId, path: dir })
				.then((nodes) => {
					if (cancelled) return;
					setMentionCandidates(
						nodes
							.filter((n) => n.name.toLowerCase().startsWith(prefix))
							.slice(0, 12)
							.map((n) => ({ path: n.path, name: n.name, kind: n.kind })),
					);
				})
				.catch(() => {
					if (!cancelled) setMentionCandidates([]);
				});
		}, 120);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [mentionQuery, workspaceId]);

	const onMentionQuery = useCallback((q: string | null) => setMentionQuery(q), []);

	const onSelectModel = (model: WireModel) => {
		useAppStore.getState().setCurrentModel(sessionId, model);
		getTransport()
			.request("session.setModel", { sessionId, model })
			.catch(() => {});
	};

	const onSelectThinking = (level: ThinkingLevel) => {
		useAppStore.getState().setThinkingLevel(sessionId, level);
		getTransport()
			.request("session.setThinkingLevel", { sessionId, level })
			.catch(() => {});
	};

	const onSubmit = (text: string, images: ImageContent[], behavior: SubmitBehavior) => {
		if (text) useAppStore.getState().appendUserMessage(sessionId, text);
		const params = { sessionId, text, ...(images.length > 0 ? { images } : {}) };
		const method =
			behavior === "steer"
				? "session.steer"
				: behavior === "followUp"
					? "session.followUp"
					: "session.prompt";
		getTransport()
			.request(method, params)
			// A rejected send (e.g. `prompt()` throwing "no API key" / a bad model) must land in the chat, not
			// be swallowed — otherwise the turn just looks frozen. Streaming faults arrive as pi events instead.
			.catch((err) => useAppStore.getState().appendErrorTurn(sessionId, errorText(err)));
	};

	const onAbort = () => {
		getTransport()
			.request("session.abort", { sessionId })
			.catch(() => {});
	};

	// A turn-divider's "files changed" chip → deep-link the right panel to the first changed file (flip to
	// Changes + highlight its row; the diff opens only on an explicit click). This is the one chat touch of
	// the store outside the renderers, kept here in the integration layer.
	const onOpenChanges = useCallback(
		(paths: string[]) => {
			const path = paths[0];
			if (!path) return;
			useAppStore.getState().requestChangesView(workspaceId, path);
		},
		[workspaceId],
	);

	// The questionnaire cards' transcript-derived lifecycle (awaiting / answered / superseded) — provided
	// as context so the presentational card stays store-free (see askState.ts).
	const askStates = useMemo(
		() => deriveAskStates(runtime.turns, runtime.askAnswers),
		[runtime.turns, runtime.askAnswers],
	);

	// Interactive tool renderers reach the agent through this context (kept out of the presentational
	// renderers). Currently: the inline `ask_user_question` card sending its reply. The promise is handed
	// to the caller — the card owns the failure UX (it un-latches its "sent" state).
	const chatActions = useMemo<ChatActions>(
		() => ({
			answerQuestion: (toolCallId: string, result: AskUserQuestionResult) =>
				getTransport()
					.request("session.answerQuestion", { sessionId, toolCallId, result })
					.then(() => undefined),
		}),
		[sessionId],
	);

	const onExtUiReply = (value: string | boolean | null) => {
		if (!pendingExtUi) return;
		const id = pendingExtUi.id;
		useAppStore.getState().clearPendingExtUi(sessionId, id);
		getTransport()
			.request("session.extUiReply", { response: { id, value } })
			.catch(() => {});
	};

	const widgetEntries = Object.entries(extUiWidget);

	return (
		<ChatActionsContext.Provider value={chatActions}>
			<AskStatesContext.Provider value={askStates}>
				<div className="flex h-full min-h-0 flex-col bg-bg">
					{/* The plan popover is anchored to the whole header, so it hangs flush under it at the chat's
					    left edge; the strip in the header's left slot is the trigger. */}
					<Popover open={planOpen} onOpenChange={setPlanOpen}>
						<PopoverAnchor asChild>
							<div className="shrink-0">
								<ChatHeader
									stats={stats}
									statusEntries={Object.entries(extUiStatus)}
									left={
										plan.data ? (
											<PopoverTrigger asChild>
												<button
													type="button"
													data-testid="chat-plan-toggle"
													data-open={planOpen}
													className="flex min-w-0 items-center gap-xs text-muted text-xs hover:text-text"
												>
													<ChatPlanStripContent plan={plan} open={planOpen} />
												</button>
											</PopoverTrigger>
										) : null
									}
									skillsStale={skillsStale}
									{...(projectId ? { onOpenSkills: () => setSkillsOpen(true) } : {})}
								/>
							</div>
						</PopoverAnchor>
						<ChatPlanContent plan={plan} />
					</Popover>
					<div
						data-testid="chat-scroll"
						className="relative flex min-h-0 flex-1 flex-col"
						{...containerProps}
					>
						<Virtuoso<ChatRow, ChatListContext>
							ref={virtuosoRef}
							data={rows}
							context={listContext}
							components={CHAT_LIST_COMPONENTS}
							className="min-h-0 flex-1"
							followOutput={followOutput}
							atBottomStateChange={handleAtBottom}
							atBottomThreshold={50}
							// Row ids are stable across streaming snapshots (rows.ts), so items never remount mid-stream.
							computeItemKey={(_, row) => row.id}
							itemContent={(_, row) => (
								<div className="mx-auto max-w-3xl px-md py-xs">
									<ChatTurnView
										row={row}
										workspaceRoot={workspaceRoot}
										onOpenChanges={onOpenChanges}
									/>
								</div>
							)}
						/>
						{showScrollButton ? (
							<button
								type="button"
								data-testid="scroll-to-bottom"
								onClick={scrollToBottom}
								className="-translate-x-1/2 absolute bottom-md left-1/2 flex items-center gap-xs rounded-[var(--radius-lg)] border border-border2 bg-elevated px-sm py-xs text-muted text-xs shadow-[var(--shadow-md)] hover:bg-hover hover:text-text"
							>
								<ArrowDown className="size-3" />
								New messages
							</button>
						) : null}
					</div>
					{widgetEntries.length > 0 ? (
						<div className="shrink-0 border-border2 border-t bg-elevated px-md py-xs text-muted text-xs">
							{widgetEntries.map(([key, lines]) => (
								<div key={key}>{lines.join(" ")}</div>
							))}
						</div>
					) : null}
					<Composer
						value={draft}
						onChange={(v) => useAppStore.getState().setChatDraft(sessionId, v)}
						isStreaming={isStreaming}
						commands={commands}
						mentionCandidates={mentionCandidates}
						models={models}
						currentModel={currentModel}
						thinkingLevel={thinkingLevel}
						onMentionQuery={onMentionQuery}
						onSelectModel={onSelectModel}
						onSelectThinking={onSelectThinking}
						onSubmit={onSubmit}
						onAbort={onAbort}
					/>
					{pendingExtUi ? (
						<ExtUiDialog key={pendingExtUi.id} request={pendingExtUi} onReply={onExtUiReply} />
					) : null}
					{projectId ? (
						<SkillsDialog
							workspaceId={workspaceId}
							sessionId={sessionId}
							projectId={projectId}
							streaming={isStreaming}
							stale={skillsStale}
							open={skillsOpen}
							onOpenChange={setSkillsOpen}
							onReloaded={() => setSkillsStale(false)}
						/>
					) : null}
				</div>
			</AskStatesContext.Provider>
		</ChatActionsContext.Provider>
	);
}
