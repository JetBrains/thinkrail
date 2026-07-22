import type {
	AskUserQuestionResult,
	ImageContent,
	PromptHit,
	SlashCommandInfo,
	TemplateInfo,
	ThinkingLevel,
	WireModel,
} from "@thinkrail/contracts";
import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Popover, PopoverAnchor, PopoverTrigger } from "@/components/ui/popover";
import { EMPTY_RUNTIME, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { AskStatesContext, deriveAskStates } from "./askState";
import { type ChatActions, ChatActionsContext } from "./ChatActions";
import { ChatHeader } from "./ChatHeader";
import { ChatPlanContent, ChatPlanStripContent } from "./ChatPlan";
import {
	Composer,
	type ComposerHandle,
	type MentionCandidate,
	type SubmitBehavior,
} from "./Composer";
import { ExtUiDialog } from "./ExtUiDialog";
import { HistoryOverlay } from "./HistoryOverlay";
import { type ChatRow, deriveRows, rowIndexForTurn } from "./rows";
import { StreamIndicator, type StreamStatus, streamStatus } from "./StreamIndicator";
import { parseTemplateSlots } from "./slotSession";
import { TemplateEditorDialog } from "./TemplateEditorDialog";
import { stripFrontmatter } from "./templateText";
import "./tools/register"; // side-effect: register the built-in pi tool renderers (bash/read/edit/write)
import { ChatTurnView } from "./turns";
import type { ChatTurn } from "./types";
import { useChatScroll } from "./useChatScroll";
import { useChatTodos } from "./useChatTodos";
import { useHistorySearch } from "./useHistorySearch";

/**
 * Best-effort plain text for a turn — user: `message.content` (a plain string, or text/image blocks);
 * assistant: joined text blocks. `system`/`error`/`retry` turns fall through to `""`. Two consumers:
 * anchor-matching a `chatLocationRequest` jump target (`turnIdByMessageIndex` only maps user/assistant
 * messages, so a non-anchor turn's `""` never matches and is never wrongly selected by the fallback scan),
 * and `recentPrompts` below (user turns only, so the assistant/`""` branches never surface there).
 */
function turnAnchorText(turn: ChatTurn): string {
	if (turn.kind === "user") {
		const { content } = turn.message;
		return typeof content === "string"
			? content
			: content
					.filter((b) => b.type === "text")
					.map((b) => b.text)
					.join("\n");
	}
	if (turn.kind === "assistant") {
		return turn.message.content
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join("\n");
	}
	return "";
}

/** A fresh `template.list` row, mapped to the shape the composer's `/` menu already renders
 * (`Composer.tsx:246-261`, unchanged) — `sourceInfo` synthesized to match pi's own prompt-template
 * convention exactly (`createSyntheticSourceInfo` in `@earendil-works/pi-coding-agent`'s
 * `core/source-info.js`): `source: "local"`, `origin: "top-level"`, `scope` mapped from our
 * "global"/"project" to pi's "user"/"project". */
function templateToCommand(t: TemplateInfo): SlashCommandInfo {
	return {
		name: t.name,
		...(t.description ? { description: t.description } : {}),
		source: "prompt",
		sourceInfo: {
			path: t.filePath,
			source: "local",
			scope: t.scope === "global" ? "user" : "project",
			origin: "top-level",
		},
	};
}

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
	const templatesVersion = useAppStore((s) => s.templatesVersion);
	const workspaceRoot = useAppStore((s) => {
		for (const workspaces of Object.values(s.workspaces)) {
			const workspace = workspaces.find((w) => w.id === workspaceId);
			if (workspace) return workspace.worktreePath;
		}
		return undefined;
	});
	// Same walk as `workspaceRoot` above, but keyed on the record's own key — `workspaces` is
	// `Record<projectId, Workspace[]>`, so the walk already has the owning project id (the "project" /
	// "all" history-search scopes need it).
	const projectId = useAppStore((s) => {
		for (const [pid, list] of Object.entries(s.workspaces)) {
			if (list.some((w) => w.id === workspaceId)) return pid;
		}
		return undefined;
	});
	// The raw record is a stable reference from zustand's perspective (unlike a fresh object/array
	// literal, which would re-render this view on every unrelated store update); the workspaceId →
	// display-name map the history overlay's cross-workspace chip needs is derived below in a `useMemo`.
	const workspaces = useAppStore((s) => s.workspaces);
	const workspaceNames = useMemo(() => {
		const map: Record<string, string> = {};
		for (const list of Object.values(workspaces)) {
			for (const w of list) map[w.id] = w.name;
		}
		return map;
	}, [workspaces]);
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

	// The plain `↑`-recall list (`Composer`'s `recentPrompts` prop): this chat's own user-turn texts,
	// newest first, deduped keeping the NEWEST occurrence — the same recency-first ranking rule as the
	// server history index (and the atuin/fzf convention it follows). Reuses `turnAnchorText`'s
	// user-content extraction (string, or joined text blocks) rather than re-deriving it. Reverse to
	// newest→oldest *before* deduping: `Set` keeps each string's first-seen entry, so reversing first
	// makes that first-seen entry the newest one, not the oldest (see `chat/SPEC.md`).
	const recentPrompts = useMemo(() => {
		const texts = turns
			.filter((t) => t.kind === "user")
			.map((t) => turnAnchorText(t))
			.filter(Boolean);
		return [...new Set(texts.reverse())];
	}, [turns]);

	const [mentionQuery, setMentionQuery] = useState<string | null>(null);
	const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
	// The chat's TODO plan, surfaced inline via a header strip that opens a popup over the chat (design-todos).
	const plan = useChatTodos(workspaceId, sessionId);
	const [planOpen, setPlanOpen] = useState(false);
	const [slashActive, setSlashActive] = useState(false);
	const [templates, setTemplates] = useState<TemplateInfo[]>([]);
	// The history overlay's save-as-template dialog: non-null while open, carrying the prompt hit its body
	// is prefilled from — `TemplateEditorDialog` itself is always mounted (controlled by `open` below), the
	// same idiom `panels/TemplatesSettings.tsx` uses for its own New/Edit instance.
	const [saveAsTemplateHit, setSaveAsTemplateHit] = useState<PromptHit | null>(null);

	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const { followOutput, handleAtBottom, showScrollButton, scrollToBottom, containerProps } =
		useChatScroll(virtuosoRef);
	const composerRef = useRef<ComposerHandle>(null);

	// The Ctrl+R history-recall overlay's integration edge (store/transport) — see `chat/SPEC.md`'s
	// boundary section for why this hook, not this component's body, owns that edge.
	const {
		state: historyState,
		openOverlay,
		close: closeHistory,
		setQuery,
		cycleScope,
		setScope,
		toggleStage,
		moveSelection,
		openMessage,
	} = useHistorySearch(sessionId, workspaceId, projectId);

	// The history-search "jump to message" deep link this session is the target of, if any — cleared by
	// this effect below once it has resolved (or failed to resolve) a row to scroll to. `CenterTabs` is the
	// other consumer: it opens/hydrates the target chat's tab but never clears the request (see its own
	// effect's jsdoc).
	const chatLocationRequest = useAppStore((s) => s.chatLocationRequest);
	const [flashRowId, setFlashRowId] = useState<string | null>(null);

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

	// Fresh prompt templates for the `/` menu merge (`mergedCommands` below) — fetched when the slash menu
	// opens (`slashActive`, via `onSlashActive`), cached per `(workspaceId, templatesVersion)` pair so
	// reopening the menu doesn't re-fetch until a `template.save`/`delete` bumps the store's
	// `templatesVersion` counter (Task B6's Templates settings panel). This is what keeps this path fresh
	// where the typed-through `/name args` expansion (pi's own session-create-time `commands` snapshot)
	// is deliberately stale — see `chat/SPEC.md`'s Template slots section.
	const templatesCacheKey = useRef<string | null>(null);
	useEffect(() => {
		if (!slashActive) return;
		const key = `${workspaceId}:${templatesVersion}`;
		if (templatesCacheKey.current === key) return;
		let cancelled = false;
		getTransport()
			.request("template.list", { workspaceId })
			.then((res) => {
				if (cancelled) return;
				// Only latch the cache key on SUCCESS — a failed/racing fetch must never latch an empty
				// cache until the next `templatesVersion` bump. Reopening the menu after a failure retries.
				templatesCacheKey.current = key;
				setTemplates(res.templates);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [slashActive, workspaceId, templatesVersion]);

	// The composer's `/` menu merge: pi's `commands` snapshot minus its now-stale `source === "prompt"`
	// entries, plus the fresh template list mapped to the same `SlashCommandInfo` shape — one list,
	// `Composer`'s rendering is unchanged (`Composer.tsx:246-261`).
	const mergedCommands = useMemo(
		() => [...commands.filter((c) => c.source !== "prompt"), ...templates.map(templateToCommand)],
		[commands, templates],
	);

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

	// Ctrl+R in the composer seeds the overlay with the current draft (never a stale store value) —
	// `useHistorySearch` owns everything from here (debounce, scope cycling, stale-response drop).
	const onHistoryOpen = () => openOverlay(draft);

	// Enter on a prompt hit: replace the draft, focus, caret at end, close — no submit.
	const onInsertHit = (hit: PromptHit) => {
		composerRef.current?.insertText(hit.text);
		closeHistory();
	};

	// Cmd/Ctrl+Enter on a prompt hit: reuse the exact `onSubmit` path a normal composer send takes, then
	// clear the draft the same way `Composer`'s own `submit()` does after sending.
	const onInsertAndSendHit = (hit: PromptHit) => {
		onSubmit(hit.text, [], isStreaming ? "followUp" : "send");
		useAppStore.getState().setChatDraft(sessionId, "");
		closeHistory();
	};

	// A prompt hit's save-as-template action (row button or Cmd/Ctrl+S): close the overlay and open the
	// shared editor dialog, body-prefilled with the hit's text — the dialog owns naming/scope/save from here.
	const onSaveAsTemplateHit = (hit: PromptHit) => {
		closeHistory();
		setSaveAsTemplateHit(hit);
	};

	// Picking a `source: "prompt"` row: fetch the real file (never `commands`' frozen snapshot), split off
	// the frontmatter (`templateText.ts`'s shared `stripFrontmatter` — pi's own parser is server-only, but
	// the boundary rule is pinned to match it exactly), parse the body into slots, and hand the result to
	// `Composer`'s `insertTemplate` — which starts (or skips, if there are no slots) a slot session,
	// replacing the whole draft the way `pickSlash` does.
	const onPickTemplate = useCallback(
		(name: string) => {
			getTransport()
				.request("template.get", { workspaceId, name })
				.then((t) => {
					const parsed = parseTemplateSlots(stripFrontmatter(t.content), t.argumentHint);
					composerRef.current?.insertTemplate(parsed);
				})
				.catch(() => {});
		},
		[workspaceId],
	);

	// Consume a `chatLocationRequest` targeting this session: resolve its `messageIndex` to a turn (via
	// `turnIdByMessageIndex`, falling back to scanning by `anchorText` when the map entry is absent —
	// e.g. this runtime came from an already-live `hydrateSession` no-op, or the index is stale after
	// compaction — or when the mapped turn's own text no longer contains the anchor), scroll its row into
	// view, and flash it briefly. `rows.length > 0` guards against running before the transcript is ready
	// (a fresh tab renders zero rows for one tick). Always clears the request — this is its only consumer.
	useEffect(() => {
		if (!chatLocationRequest || chatLocationRequest.sessionId !== sessionId || rows.length === 0) {
			return;
		}
		const { messageIndex, anchorText } = chatLocationRequest;
		const prefix = anchorText.slice(0, 40);
		const mappedId = runtime.turnIdByMessageIndex?.[messageIndex];
		const mapped = mappedId ? turns.find((t) => t.id === mappedId) : undefined;
		const target =
			mapped && turnAnchorText(mapped).includes(prefix)
				? mapped
				: turns.find((t) => turnAnchorText(t).includes(prefix));
		const index = target ? rowIndexForTurn(rows, target.id) : -1;
		if (index === -1) {
			toast.error("couldn't locate the message — the session may have changed");
			useAppStore.getState().clearChatLocation();
			return;
		}
		virtuosoRef.current?.scrollToIndex({ index, align: "center" });
		setFlashRowId(rows[index]?.id ?? null);
		useAppStore.getState().clearChatLocation();
	}, [chatLocationRequest, sessionId, rows, runtime.turnIdByMessageIndex, turns]);

	// Auto-clear the flash, decoupled from the effect above: `clearChatLocation()` there flips
	// `chatLocationRequest` to null, which is one of that effect's own deps — if the timeout lived there,
	// the re-run's cleanup would cancel it (and the re-run bails on `!chatLocationRequest` before
	// scheduling a replacement), so `flashRowId` would never reset. Keying solely on `flashRowId` avoids
	// that churn: this effect only fires when a flash actually starts or ends.
	useEffect(() => {
		if (flashRowId === null) return;
		const timer = setTimeout(() => setFlashRowId(null), 1600);
		return () => clearTimeout(timer);
	}, [flashRowId]);

	// A turn-divider's "files changed" chip → surface the first changed file's diff in the right panel.
	// This is the one chat touch of the store outside the renderers, kept here in the integration layer.
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
								<div
									data-flash={row.id === flashRowId || undefined}
									className="mx-auto max-w-3xl rounded-[var(--radius-md)] px-md py-xs transition-colors data-[flash]:bg-[var(--primary-10)]"
								>
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
					<div className="relative shrink-0">
						<HistoryOverlay
							state={historyState}
							workspaceNames={workspaceNames}
							onQueryChange={setQuery}
							onCycleScope={cycleScope}
							onSetScope={setScope}
							onToggleStage={toggleStage}
							onMoveSelection={moveSelection}
							onClose={closeHistory}
							onInsert={onInsertHit}
							onInsertAndSend={onInsertAndSendHit}
							onOpenMessage={openMessage}
							onSaveAsTemplate={onSaveAsTemplateHit}
						/>
						<Composer
							ref={composerRef}
							value={draft}
							onChange={(v) => useAppStore.getState().setChatDraft(sessionId, v)}
							isStreaming={isStreaming}
							commands={mergedCommands}
							mentionCandidates={mentionCandidates}
							recentPrompts={recentPrompts}
							models={models}
							currentModel={currentModel}
							thinkingLevel={thinkingLevel}
							onMentionQuery={onMentionQuery}
							onSlashActive={setSlashActive}
							onSelectModel={onSelectModel}
							onSelectThinking={onSelectThinking}
							onSubmit={onSubmit}
							onAbort={onAbort}
							onHistoryOpen={onHistoryOpen}
							onPickTemplate={onPickTemplate}
						/>
					</div>
					<TemplateEditorDialog
						open={saveAsTemplateHit != null}
						onOpenChange={(open) => {
							if (!open) setSaveAsTemplateHit(null);
						}}
						workspaceId={workspaceId}
						initialBody={saveAsTemplateHit?.text ?? ""}
					/>
					{pendingExtUi ? (
						<ExtUiDialog key={pendingExtUi.id} request={pendingExtUi} onReply={onExtUiReply} />
					) : null}
				</div>
			</AskStatesContext.Provider>
		</ChatActionsContext.Provider>
	);
}
