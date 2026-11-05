import { RiHistoryLine } from "@remixicon/react";
import { type ChatActions, ChatActionsContext } from "@thinkrail/chat-ui/ChatActions";
import {
	Composer,
	type ComposerHandle,
	type ComposerSubmitDisposition,
	type SubmitBehavior,
} from "@thinkrail/chat-ui/Composer";
import { ExtraUsageNotice } from "@thinkrail/chat-ui/ExtraUsageNotice";
import {
	type PendingExtUi,
	PendingExtUiContext,
	PendingExtUiPrompt,
} from "@thinkrail/chat-ui/ExtUiPrompt";
import { messagesToRuntime } from "@thinkrail/chat-ui/hydrate";
import {
	awaitingToolCallIdOf,
	deriveInteractionStates,
	InteractionStatesContext,
} from "@thinkrail/chat-ui/interactionState";
import type { ModelEffortPickerHandle, ModelSelection } from "@thinkrail/chat-ui/ModelEffortPicker";
import { deriveMessageActions } from "@thinkrail/chat-ui/messageActions";
import type { ModelPreferences } from "@thinkrail/chat-ui/modelPreferences";
import { QueueStrip } from "@thinkrail/chat-ui/QueueStrip";
import { deriveRows, rowsHaveToolCall } from "@thinkrail/chat-ui/rows";
import { StreamIndicator, streamStatus } from "@thinkrail/chat-ui/StreamIndicator";
import { ChatTurnView } from "@thinkrail/chat-ui/turns";
import type { ChatAttachment } from "@thinkrail/chat-ui/types";
import {
	DEFAULT_CONFIG,
	type ExtUiRequest,
	type ProviderWarning,
	type QueueLane,
	type RemovedQueuedMessage,
	type SessionEventPayload,
	type SessionQueueContent,
	type SessionQueueState,
	type SessionState,
	type SlashCommandInfo,
	type ThinkingLevel,
	type TranscriptMessage,
	type WireModel,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import type { RemoteSessionItem, RemoteSessionsController } from "@thinkrail/remote-client";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { phoneDialog } from "./extUiDialog";
import { Loader, Notice, Screen } from "./layout";
import {
	NO_QUEUE,
	type PhoneNote,
	phoneExtUi,
	queuedDraft,
	queueOf,
	withNotes,
} from "./liveSession";
import { ModelSheet } from "./ModelSheet";
import { useHostRequest } from "./useHostRequest";
import { useWorkspaceChats } from "./WorkspaceScreen";

export interface OpenSession {
	hostKey: string;
	sessionId: string;
	workspaceId: string;
	/** Tool cards and file lists show paths relative to it. */
	workspaceRoot?: string;
	title: string;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
	/** A first message that could not be sent when the chat was started: back in the field, with why. */
	unsent?: { text: string; reason: string };
}

const REFRESH_COALESCE_MS = 400;
/** Text buttons inside the transcript and the dialog dock are touch targets on a phone. */
const TOUCH_BUTTONS = "[&_[data-slot=button]:not([data-icon-only])]:min-h-touch";
/** Icon buttons in the strips above the composer are touch-sized too. */
const TOUCH_ICONS = "[&_[data-icon-only]]:size-touch";
const NO_PROMPTS: string[] = [];
/** The IDE's "Try again" after a provider failure: one more turn on the same conversation. */
const TRY_AGAIN_PROMPT = "Try again.";

/** The phone has no picker preferences store: the picker shows the catalog, with no favorites or defaults. */
const PHONE_MODEL_PREFERENCES: ModelPreferences = {
	supported: false,
	favorites: [],
	recents: [],
	defaultEffort: undefined,
	isFavorite: () => false,
	toggleFavorite: () => {},
	isDefault: () => false,
	setDefault: () => {},
};

const reasonOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export function SessionScreen({
	session,
	state,
	controller,
	items,
	backLabel,
	onBack,
	onHistory,
	onOpenSubagent,
}: {
	session: OpenSession;
	state: SessionState | undefined;
	controller: RemoteSessionsController;
	items: RemoteSessionItem[];
	backLabel: string;
	onBack: () => void;
	onHistory: () => void;
	onOpenSubagent: (childSessionId: string) => void;
}) {
	const t = useT();
	const { hostKey, sessionId, workspaceId } = session;
	const client = controller.clientFor(hostKey);
	const [messages, setMessages] = useState<TranscriptMessage[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [draft, setDraft] = useState(session.unsent?.text ?? "");
	const [model, setModel] = useState(session.model);
	const [thinkingLevel, setThinkingLevel] = useState(session.thinkingLevel);
	const [sendError, setSendError] = useState<string | null>(session.unsent?.reason ?? null);
	const bottom = useRef<HTMLDivElement>(null);
	const composerRef = useRef<ComposerHandle>(null);
	const isStreaming = state?.execution === "running";
	/** Hides a dialog the moment it is answered, before the host's next state drops it. */
	const [answeredDialogId, setAnsweredDialogId] = useState<string | null>(null);
	const dialog = phoneDialog(state, answeredDialogId);
	const dialogDrafts = useRef(new Map<string, string>());
	const revealedDialogs = useRef(new Set<string>());

	const models = useHostRequest<WireModel[]>(client, "model.list", {});
	/** The model picker lives above the field on a phone; `/model` in the composer opens it through this. */
	const pickerRef = useRef<ModelEffortPickerHandle>(null);
	const externalPicker = useMemo<ModelEffortPickerHandle>(
		() => ({ open: (query) => pickerRef.current?.open(query) }),
		[],
	);
	const commands = useHostRequest<SlashCommandInfo[]>(client, "session.getCommands", { sessionId });
	const chats = useWorkspaceChats(client, workspaceId, items);
	/** Live from `queue_update`; until the first one, what the chat list read reported. */
	const [liveQueue, setLiveQueue] = useState<SessionQueueState | null>(null);
	const queue =
		liveQueue ??
		(chats.kind === "ready"
			? chats.value.find((chat) => chat.sessionId === sessionId)?.queue
			: undefined) ??
		NO_QUEUE;
	const [notes, setNotes] = useState<PhoneNote[]>([]);
	const [notice, setNotice] = useState<ProviderWarning | null>(null);
	const [disablingNotice, setDisablingNotice] = useState(false);
	const lastTurnId = useRef<string | null>(null);

	useEffect(() => {
		if (!client) return;
		let cancelled = false;
		let pending: ReturnType<typeof setTimeout> | undefined;
		const refresh = (): void => {
			client
				.request<{ messages: TranscriptMessage[] }>("session.getMessages", {
					sessionId,
					workspaceId,
				})
				.then((result) => {
					if (cancelled) return;
					setMessages(result.messages);
					setLoadError(null);
				})
				.catch((error: unknown) => {
					if (!cancelled) setLoadError(reasonOf(error));
				});
		};
		refresh();
		const unsubscribe = client.subscribe(WS_CHANNELS.piEvent, (data) => {
			const payload = data as SessionEventPayload;
			if (payload.sessionId !== sessionId) return;
			const nextQueue = queueOf(payload.event);
			if (nextQueue) setLiveQueue(nextQueue);
			if (pending) return;
			pending = setTimeout(() => {
				pending = undefined;
				refresh();
			}, REFRESH_COALESCE_MS);
		});
		const unsubscribeExtUi = client.subscribe(WS_CHANNELS.piExtensionUi, (data) => {
			const shown = phoneExtUi(data as ExtUiRequest, sessionId, lastTurnId.current);
			if (shown?.kind === "note") setNotes((current) => [...current, shown.note]);
			else if (shown?.kind === "notice") setNotice(shown.notice);
		});
		return () => {
			cancelled = true;
			if (pending) clearTimeout(pending);
			unsubscribe();
			unsubscribeExtUi();
		};
	}, [client, sessionId, workspaceId]);

	const runtime = useMemo(
		() => (messages ? messagesToRuntime(messages, undefined, { idScope: sessionId }) : null),
		[messages, sessionId],
	);
	const turns = useMemo(() => (runtime ? withNotes(runtime.turns, notes) : []), [runtime, notes]);
	useEffect(() => {
		lastTurnId.current = runtime?.turns.at(-1)?.id ?? null;
	}, [runtime]);
	const rows = useMemo(
		() => (runtime ? deriveRows(turns, runtime.toolResults, isStreaming) : []),
		[runtime, turns, isStreaming],
	);
	const status = isStreaming && runtime ? streamStatus(runtime.turns, null) : null;
	const messageActions = useMemo(
		() => deriveMessageActions(rows, isStreaming),
		[rows, isStreaming],
	);
	const focusScope = useMemo(() => ({ sessionId }), [sessionId]);
	const awaitingToolCallId = awaitingToolCallIdOf(state ?? null);
	const interactionContext = useMemo(
		() => ({
			states: runtime
				? deriveInteractionStates(runtime.turns, runtime.toolResponses, runtime.toolResults)
				: {},
			focusScope,
			awaitingToolCallId,
		}),
		[runtime, focusScope, awaitingToolCallId],
	);
	const pendingExtUi = useMemo<PendingExtUi | null>(() => {
		if (!client || !dialog) return null;
		const { id } = dialog;
		return {
			request: dialog,
			reply: (value) => {
				setAnsweredDialogId(id);
				dialogDrafts.current.delete(id);
				client
					.request("session.extUiReply", { response: { id, value } })
					.catch((error: unknown) => {
						setAnsweredDialogId(null);
						setSendError(reasonOf(error));
					});
			},
			draft: () => dialogDrafts.current.get(id),
			rememberDraft: (text) => {
				dialogDrafts.current.set(id, text);
			},
			claimReveal: () => {
				if (revealedDialogs.current.has(id)) return false;
				revealedDialogs.current.add(id);
				return true;
			},
		};
	}, [client, dialog]);
	const dialogOnToolCard =
		pendingExtUi?.request.toolCallId !== undefined &&
		rowsHaveToolCall(rows, pendingExtUi.request.toolCallId);
	const chatActions = useMemo<ChatActions | null>(
		() =>
			client && {
				cancelAutomaticReveal: () => {},
				focusComposer: () => composerRef.current?.refocus(),
				openSubagentTranscript: onOpenSubagent,
				respondToTool: (toolCallId, response) =>
					client
						.request("session.respondToTool", { sessionId, toolCallId, response })
						.then(() => undefined),
				resultOpener: () => undefined,
				revealChatElement: (element) => element.scrollIntoView({ block: "nearest" }),
			},
		[client, sessionId, onOpenSubagent],
	);

	useEffect(() => {
		if (rows.length) bottom.current?.scrollIntoView({ block: "end" });
	}, [rows.length]);

	const request = (method: string, params: Record<string, unknown>): Promise<unknown> =>
		client ? client.request(method, params) : Promise.reject(new Error("not connected"));

	const send = (
		text: string,
		attachments: ChatAttachment[],
		behavior: Exclude<SubmitBehavior, "interrupt">,
	): void => {
		setSendError(null);
		const images = attachments.map((attachment) => attachment.content);
		const method =
			behavior === "steer"
				? "session.steer"
				: behavior === "followUp"
					? "session.followUp"
					: "session.prompt";
		request(method, { sessionId, text, ...(images.length > 0 ? { images } : {}) }).catch(
			(error: unknown) => {
				setDraft(text);
				setSendError(reasonOf(error));
			},
		);
	};

	const restoreQueued = (content: SessionQueueContent): void => {
		const restored = queuedDraft(draft, content);
		setDraft(restored.text);
		composerRef.current?.restoreAttachments(
			restored.images.map((image, index) => ({
				name: `queued-image-${index + 1}`,
				content: image,
			})),
		);
		composerRef.current?.refocus();
	};

	const removeQueued = (kind: QueueLane, index: number, restore: boolean): void => {
		client
			?.request<RemovedQueuedMessage>("session.removeQueued", { sessionId, kind, index })
			.then(({ removed, queue: next }) => {
				setLiveQueue(next);
				if (restore && removed) restoreQueued({ steering: [removed], followUp: [] });
			})
			.catch((error: unknown) => setSendError(reasonOf(error)));
	};

	const disableNotice = (): void => {
		if (!notice) return;
		setDisablingNotice(true);
		request("provider.disableWarning", { warning: notice })
			.then(() => setNotice(null))
			.catch((error: unknown) => setSendError(reasonOf(error)))
			.finally(() => setDisablingNotice(false));
	};

	const onSubmit = (
		text: string,
		attachments: ChatAttachment[],
		behavior: SubmitBehavior,
	): ComposerSubmitDisposition => {
		if (!client) return { accepted: false, reason: t("mobile.session.offline") };
		if (behavior !== "interrupt") {
			send(text, attachments, behavior);
			return { accepted: true };
		}
		request("session.abort", { sessionId })
			.then(() => send(text, attachments, "send"))
			.catch((error: unknown) => setSendError(reasonOf(error)));
		return { accepted: true };
	};

	const tryAgain = (): void => {
		if (client) send(TRY_AGAIN_PROMPT, [], "send");
	};

	const onSelectThinking = (level: ThinkingLevel): void => {
		const previous = thinkingLevel;
		setThinkingLevel(level);
		request("session.setThinkingLevel", { sessionId, level }).catch(() =>
			setThinkingLevel(previous),
		);
	};

	const onSelectModel = ({ model: next, level }: ModelSelection): void => {
		const previous = model;
		setModel(next);
		request("session.setModel", { sessionId, model: next }).then(
			() => {
				if (level) onSelectThinking(level);
			},
			() => setModel(previous),
		);
	};

	return (
		<ChatActionsContext.Provider value={chatActions}>
			<PendingExtUiContext.Provider value={pendingExtUi}>
				<InteractionStatesContext.Provider value={interactionContext}>
					<Screen
						title={session.title}
						back={{ label: backLabel, onBack }}
						action={
							chats.kind === "ready" && chats.value.length > 1 ? (
								<IconButton
									size="l"
									className="size-touch shrink-0"
									icon={RiHistoryLine}
									label={t("mobile.workspace.history")}
									onClick={onHistory}
								/>
							) : undefined
						}
						footer={
							<footer className="@container bg-container-workspace-bg pb-safe-bottom">
								{sendError ? (
									<p
										role="alert"
										className="m-0 px-chat-gutter py-8 text-feedback-error tr-text-metadata"
									>
										{t("mobile.session.sendFailed", { reason: sendError })}
									</p>
								) : null}
								{pendingExtUi && !dialogOnToolCard ? (
									<div
										data-testid="ext-ui-dock"
										className={cn(
											"flex max-h-[60dvh] min-h-0 flex-col overflow-y-auto px-chat-gutter pt-8",
											TOUCH_BUTTONS,
										)}
									>
										<PendingExtUiPrompt pending={pendingExtUi} />
									</div>
								) : null}
								{notice === "anthropicExtraUsage" ? (
									<ExtraUsageNotice
										context="chat"
										className={cn("mx-chat-gutter mt-8", TOUCH_ICONS)}
										onDismiss={() => setNotice(null)}
										onDisable={disableNotice}
										disabling={disablingNotice}
									/>
								) : null}
								<div className={TOUCH_ICONS}>
									<QueueStrip
										queue={queue}
										onEdit={(kind, index) => removeQueued(kind, index, true)}
										onRemove={(kind, index) => removeQueued(kind, index, false)}
									/>
								</div>
								<div className="flex min-w-0 items-center px-chat-gutter pt-8">
									<ModelSheet
										ref={pickerRef}
										models={models.kind === "ready" ? models.value : []}
										current={model}
										level={thinkingLevel}
										onSelect={onSelectModel}
										onSelectLevel={onSelectThinking}
									/>
								</div>
								<Composer
									ref={composerRef}
									value={draft}
									onChange={setDraft}
									isStreaming={isStreaming}
									growthLimit={DEFAULT_CONFIG.composerGrowthLimit}
									commands={commands.kind === "ready" ? commands.value : []}
									templatePending={false}
									mentionCandidates={[]}
									recentPrompts={NO_PROMPTS}
									models={models.kind === "ready" ? models.value : []}
									modelsRefreshing={models.kind === "loading"}
									onRefreshModels={() => {}}
									currentModel={model}
									thinkingLevel={thinkingLevel}
									modelPreferences={PHONE_MODEL_PREFERENCES}
									onMentionQuery={() => {}}
									onSlashActive={() => {}}
									onSelectModel={onSelectModel}
									onSelectThinking={onSelectThinking}
									externalModelPicker={externalPicker}
									onSubmit={onSubmit}
									onAbort={() => {
										client
											?.request<{ restoredQueue?: SessionQueueContent }>("session.abort", {
												sessionId,
												restoreQueue: true,
											})
											.then(({ restoredQueue }) => {
												if (restoredQueue) restoreQueued(restoredQueue);
											})
											.catch((error: unknown) => setSendError(reasonOf(error)));
									}}
								/>
							</footer>
						}
					>
						<div
							className={cn("@container flex flex-col gap-8 px-chat-gutter py-16", TOUCH_BUTTONS)}
						>
							{loadError ? (
								<Notice text={t("mobile.list.failed", { reason: loadError })} alert />
							) : messages === null ? (
								<Loader text={t("mobile.session.loading")} />
							) : rows.length === 0 ? (
								<Notice text={t("mobile.session.empty")} />
							) : (
								rows.map((row) => (
									<div key={row.id}>
										<ChatTurnView
											row={row}
											onTryAgain={isStreaming ? undefined : tryAgain}
											agentResponded={messageActions.agentRespondedByUserId.get(row.id) ?? false}
											isFinalAnswer={messageActions.finalAnswerRowIds.has(row.id)}
										/>
									</div>
								))
							)}
							{status ? <StreamIndicator status={status} /> : null}
							<div ref={bottom} />
						</div>
					</Screen>
				</InteractionStatesContext.Provider>
			</PendingExtUiContext.Provider>
		</ChatActionsContext.Provider>
	);
}
