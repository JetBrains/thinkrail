import type {
	AskUserQuestionResult,
	ImageContent,
	Model,
	ThinkingLevel,
} from "@thinkrail-pi/contracts";
import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { EMPTY_RUNTIME, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { type ChatActions, ChatActionsContext } from "./ChatActions";
import { ChatHeader } from "./ChatHeader";
import { Composer, type MentionCandidate, type SubmitBehavior } from "./Composer";
import { ExtUiDialog } from "./ExtUiDialog";
import { StreamIndicator, type StreamStatus, streamStatus } from "./StreamIndicator";
import "./tools/register"; // side-effect: register the built-in pi tool renderers (bash/read/edit/write)
import { ChatTurnView, TurnDivider, turnDivider } from "./turns";
import type { ChatTurn } from "./types";
import { useChatScroll } from "./useChatScroll";

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
 * presentational chat primitives (header pickers, turn list, composer, extension-UI dialog). The renderers
 * stay store-free so they're reusable; this is the only file in `chat/` that touches store/transport.
 */
export default function ChatView({ sessionId }: { sessionId: string }) {
	// This tab's runtime — zustand only re-renders when *this* session's slice ref changes, so a background
	// chat streaming into its own runtime never re-renders the foreground one.
	const runtime = useAppStore((s) => s.sessions[sessionId]) ?? EMPTY_RUNTIME;
	const models = useAppStore((s) => s.models);
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
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
		if (mentionQuery === null || !activeWorkspaceId) {
			setMentionCandidates([]);
			return;
		}
		const slash = mentionQuery.lastIndexOf("/");
		const dir = slash >= 0 ? mentionQuery.slice(0, slash) : "";
		const prefix = (slash >= 0 ? mentionQuery.slice(slash + 1) : mentionQuery).toLowerCase();
		let cancelled = false;
		const timer = setTimeout(() => {
			getTransport()
				.request("fs.readDir", { workspaceId: activeWorkspaceId, path: dir })
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
	}, [mentionQuery, activeWorkspaceId]);

	const onMentionQuery = useCallback((q: string | null) => setMentionQuery(q), []);

	const onSelectModel = (model: Model<string>) => {
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

	// A turn-divider's "files changed" chip → surface the first changed file's diff in the right panel.
	// This is the one chat touch of the store outside the renderers, kept here in the integration layer.
	const onOpenChanges = useCallback(
		(paths: string[]) => {
			const path = paths[0];
			if (!activeWorkspaceId || !path) return;
			useAppStore.getState().requestChangesView(activeWorkspaceId, path);
		},
		[activeWorkspaceId],
	);

	// Interactive tool renderers reach the agent through this context (kept out of the presentational
	// renderers). Currently: the inline `ask_user_question` card answering its blocked tool call. The
	// promise is handed to the caller — the card owns the failure UX (it un-latches its "sent" state).
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
			<div className="flex h-full min-h-0 flex-col bg-bg">
				<ChatHeader
					models={models}
					currentModel={currentModel}
					thinkingLevel={thinkingLevel}
					stats={stats}
					statusEntries={Object.entries(extUiStatus)}
					onSelectModel={onSelectModel}
					onSelectThinking={onSelectThinking}
				/>
				<div
					data-testid="chat-scroll"
					className="relative flex min-h-0 flex-1 flex-col"
					{...containerProps}
				>
					<Virtuoso<ChatTurn, ChatListContext>
						ref={virtuosoRef}
						data={turns}
						context={listContext}
						components={CHAT_LIST_COMPONENTS}
						className="min-h-0 flex-1"
						followOutput={followOutput}
						atBottomStateChange={handleAtBottom}
						atBottomThreshold={50}
						itemContent={(index, turn) => {
							// A divider closes each round the instant it ends — below the round's last turn (its "✓ Done"
							// marker, or its final assistant turn when hydrated), i.e. when the next turn is a new user
							// turn or this is the last turn of a finished (non-streaming) transcript. Anchoring it here
							// (not before the next user turn) surfaces the summary immediately, not on the follow-up.
							const roundEnded =
								turn.kind !== "user" &&
								(turns[index + 1]?.kind === "user" || (index === turns.length - 1 && !isStreaming));
							const divider = roundEnded ? turnDivider(turns, index) : null;
							return (
								<div className="mx-auto max-w-3xl px-md py-xs">
									<ChatTurnView turn={turn} toolResults={toolResults} />
									{divider ? <TurnDivider data={divider} onOpenChanges={onOpenChanges} /> : null}
								</div>
							);
						}}
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
					onMentionQuery={onMentionQuery}
					onSubmit={onSubmit}
					onAbort={onAbort}
				/>
				{pendingExtUi ? (
					<ExtUiDialog key={pendingExtUi.id} request={pendingExtUi} onReply={onExtUiReply} />
				) : null}
			</div>
		</ChatActionsContext.Provider>
	);
}
