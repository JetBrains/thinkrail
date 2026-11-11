import { RiChatNewLine, RiEyeLine, RiHistoryLine } from "@remixicon/react";
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
	type Project,
	type QueueLane,
	type SessionQueueContent,
	sameModel,
	type ThinkingLevel,
	type WireModel,
} from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import type { RemoteSessionItem, RemoteSessionsController } from "@thinkrail/remote-client";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useModelCatalog } from "../chat/useModelCatalog";
import { useSessionStats } from "../chat/useSessionStats";
import { useTranscriptSync } from "../chat/useTranscriptSync";
import { hydrateStandaloneChat } from "../shell/chatReconciliation";
import { EMPTY_RUNTIME, useAppStore } from "../store";
import { getTransport, respondToTool } from "../transport";
import { reasonOf, singleFlight } from "./async";
import { ResourcesTool, SkillsTool } from "./ChatTools";
import { useHostClient, useHostWelcome } from "./hostView";
import { Loader, Notice, Screen } from "./layout";
import { ModelSheet } from "./ModelSheet";
import { draftWith, queuedDraft } from "./queuedDraft";
import { UsageBar } from "./SessionUsage";
import { useStoreHost } from "./storeHost";
import { type OpenChat, useStartChat, useWorkspaceChats } from "./WorkspaceScreen";

export interface OpenSession {
	hostKey: string;
	project: Project;
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

function FailureLine({ children }: { children: string }) {
	return (
		<p role="alert" className="m-0 px-chat-gutter py-8 text-feedback-error tr-text-metadata">
			{children}
		</p>
	);
}

export function SessionScreen({
	session,
	controller,
	items,
	backLabel,
	onBack,
	onHistory,
	onOpenSubagent,
	onOpenChat,
	readOnly = false,
}: {
	session: OpenSession;
	controller: RemoteSessionsController;
	items: RemoteSessionItem[];
	backLabel: string;
	onBack: () => void;
	onHistory: () => void;
	onOpenSubagent: (childSessionId: string) => void;
	/** Switches to another chat of this workspace, e.g. one just started from the header. */
	onOpenChat: (chat: OpenChat) => void;
	/** The computer lets this phone only read: no composer, model picker or answers, just a note saying so. */
	readOnly?: boolean;
}) {
	const t = useT();
	const { hostKey, sessionId, workspaceId, project } = session;
	const client = useHostClient(controller, hostKey);
	const otherAgentSkills =
		useHostWelcome(controller, hostKey)?.config.otherAgentSkills ?? DEFAULT_CONFIG.otherAgentSkills;
	const ready = useStoreHost(hostKey, client);
	const runtime = useAppStore((s) => (ready ? s.sessions[sessionId] : undefined));
	const status = useAppStore((s) => s.status);
	const connectionGeneration = useAppStore((s) => s.connectionGeneration);
	const hostProtocol = useAppStore((s) => s.protocolVersion) ?? undefined;
	const [loadError, setLoadError] = useState<string | null>(null);
	const [draft, setDraft] = useState(session.unsent?.text ?? "");
	const [failure, setFailure] = useState<string | null>(() =>
		session.unsent ? t("mobile.session.sendFailed", { reason: session.unsent.reason }) : null,
	);
	const failed = useCallback(
		(action: string, error: unknown): void =>
			setFailure(t("mobile.session.actionFailed", { action, reason: reasonOf(error) })),
		[t],
	);
	const [queueFlight] = useState(() => singleFlight());
	const [abortFlight] = useState(() => singleFlight());
	const bottom = useRef<HTMLDivElement>(null);
	const composerRef = useRef<ComposerHandle>(null);
	const isStreaming = runtime?.isStreaming ?? false;
	const model = runtime?.model ?? session.model;
	const thinkingLevel = runtime?.thinkingLevel ?? session.thinkingLevel;
	const queue = runtime?.queue ?? EMPTY_RUNTIME.queue;
	const notice = runtime?.notice ?? null;
	const stats = runtime?.stats ?? null;
	const commands = runtime?.commands ?? EMPTY_RUNTIME.commands;
	const hasRuntime = runtime !== undefined;

	useEffect(() => {
		if (!ready || hasRuntime) return;
		let cancelled = false;
		setLoadError(null);
		hydrateStandaloneChat(workspaceId, sessionId).then(
			(installed) => {
				if (!cancelled && !installed) setLoadError(t("mobile.session.offline"));
			},
			(error: unknown) => {
				if (!cancelled) setLoadError(reasonOf(error));
			},
		);
		return () => {
			cancelled = true;
		};
	}, [ready, hasRuntime, workspaceId, sessionId, t]);
	useTranscriptSync({
		workspaceId,
		sessionId,
		runtime: runtime ?? EMPTY_RUNTIME,
		status,
		connectionGeneration,
		enabled: hasRuntime,
	});
	const refreshStats = useSessionStats({
		sessionId,
		statsRefreshTick: runtime?.statsRefreshTick ?? 0,
		syncedConnectionGeneration: runtime?.syncedConnectionGeneration ?? 0,
		status,
		connectionGeneration,
		enabled: hasRuntime,
	});
	useEffect(() => {
		if (!ready) return;
		getTransport()
			.request("session.getCommands", { sessionId })
			.then((next) => useAppStore.getState().setCommands(sessionId, next))
			.catch(() => {});
	}, [ready, sessionId]);
	const { models: catalog, refreshing: modelsRefreshing } = useModelCatalog(ready);

	const pickerRef = useRef<ModelEffortPickerHandle>(null);
	const externalPicker = useMemo<ModelEffortPickerHandle>(
		() => ({ open: (query) => pickerRef.current?.open(query) }),
		[],
	);
	const chats = useWorkspaceChats(client, workspaceId, items);
	const [disablingNotice, setDisablingNotice] = useState(false);
	const [usageOpen, setUsageOpen] = useState(false);
	const {
		creating,
		failure: createFailure,
		start: startChat,
	} = useStartChat(client, workspaceId, onOpenChat);

	const rows = useMemo(
		() => (runtime ? deriveRows(runtime.turns, runtime.toolResults, isStreaming) : []),
		[runtime, isStreaming],
	);
	const status_ =
		isStreaming && runtime ? streamStatus(runtime.turns, runtime.currentAssistantId) : null;
	const messageActions = useMemo(
		() => deriveMessageActions(rows, isStreaming),
		[rows, isStreaming],
	);
	const focusScope = useMemo(() => ({ sessionId }), [sessionId]);
	const awaitingToolCallId = awaitingToolCallIdOf(runtime?.hostState ?? null);
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
	const pendingRequest = runtime?.pendingExtUi ?? null;
	const pendingExtUi = useMemo<PendingExtUi | null>(() => {
		if (!pendingRequest) return null;
		let dialogDraft: string | undefined;
		let revealed = false;
		return {
			request: pendingRequest,
			reply: (value) => {
				const { id } = pendingRequest;
				useAppStore.getState().clearPendingExtUi(sessionId, id);
				getTransport()
					.request("session.extUiReply", { response: { id, value } })
					.catch((error: unknown) => failed(t("mobile.session.answerFailed"), error));
			},
			draft: () => dialogDraft,
			rememberDraft: (text) => {
				dialogDraft = text;
			},
			claimReveal: () => {
				if (revealed) return false;
				revealed = true;
				return true;
			},
		};
	}, [pendingRequest, sessionId, failed, t]);
	const dialogOnToolCard =
		pendingExtUi?.request.toolCallId !== undefined &&
		rowsHaveToolCall(rows, pendingExtUi.request.toolCallId);
	const chatActions = useMemo<ChatActions | null>(
		() =>
			ready
				? {
						cancelAutomaticReveal: () => {},
						focusComposer: () => composerRef.current?.refocus(),
						openSubagentTranscript: onOpenSubagent,
						respondToTool: (toolCallId, response) => respondToTool(sessionId, toolCallId, response),
						resultOpener: () => undefined,
						revealChatElement: (element) => element.scrollIntoView({ block: "nearest" }),
						hostProtocol,
					}
				: null,
		[ready, sessionId, onOpenSubagent, hostProtocol],
	);

	useEffect(() => {
		if (rows.length) bottom.current?.scrollIntoView({ block: "end" });
	}, [rows.length]);

	const send = (
		text: string,
		attachments: ChatAttachment[],
		behavior: Exclude<SubmitBehavior, "interrupt">,
	): void => {
		setFailure(null);
		if (behavior === "send" && (text || attachments.length > 0)) {
			useAppStore.getState().appendUserMessage(sessionId, text, attachments);
		}
		const images = attachments.map((attachment) => attachment.content);
		const method =
			behavior === "steer"
				? "session.steer"
				: behavior === "followUp"
					? "session.followUp"
					: "session.prompt";
		getTransport()
			.request(method, { sessionId, text, ...(images.length > 0 ? { images } : {}) })
			.catch((error: unknown) => {
				restoreUnsent(text, attachments);
				setFailure(t("mobile.session.sendFailed", { reason: reasonOf(error) }));
			});
	};

	const restoreQueued = (content: SessionQueueContent): void => {
		const restored = queuedDraft(content);
		setDraft((current) => draftWith(restored.text, current));
		composerRef.current?.restoreAttachments(
			restored.images.map((image, index) => ({
				name: `queued-image-${index + 1}`,
				content: image,
			})),
		);
		composerRef.current?.refocus();
	};

	const restoreUnsent = (text: string, attachments: ChatAttachment[]): void =>
		restoreQueued({
			steering: [{ text, images: attachments.map((attachment) => attachment.content) }],
			followUp: [],
		});

	const removeQueued = (kind: QueueLane, index: number, restore: boolean): void => {
		queueFlight(() => getTransport().request("session.removeQueued", { sessionId, kind, index }))
			?.then(({ removed }) => {
				if (restore && removed) restoreQueued({ steering: [removed], followUp: [] });
			})
			.catch((error: unknown) => failed(t("mobile.session.queueFailed"), error));
	};

	const disableNotice = (): void => {
		if (!notice) return;
		setDisablingNotice(true);
		getTransport()
			.request("provider.disableWarning", { warning: notice })
			.then(() => useAppStore.getState().silenceNotice(notice))
			.catch((error: unknown) => failed(t("chat.extraUsage.disableFailed"), error))
			.finally(() => setDisablingNotice(false));
	};

	const onSubmit = (
		text: string,
		attachments: ChatAttachment[],
		behavior: SubmitBehavior,
	): ComposerSubmitDisposition => {
		if (!ready) return { accepted: false, reason: t("mobile.session.offline") };
		if (behavior !== "interrupt") {
			send(text, attachments, behavior);
			return { accepted: true };
		}
		const interrupted = abortFlight(() => getTransport().request("session.abort", { sessionId }));
		if (!interrupted) return { accepted: false, reason: t("mobile.session.stopping") };
		interrupted.then(
			() => send(text, attachments, "send"),
			(error: unknown) => {
				restoreUnsent(text, attachments);
				failed(t("mobile.session.stopFailed"), error);
			},
		);
		return { accepted: true };
	};

	const tryAgain = (): void => {
		if (ready) send(TRY_AGAIN_PROMPT, [], "send");
	};

	const live = () => useAppStore.getState().sessions[sessionId];

	const onSelectThinking = (level: ThinkingLevel): void => {
		const previous = live()?.thinkingLevel ?? thinkingLevel;
		if (level === previous) return;
		useAppStore.getState().setThinkingLevel(sessionId, level);
		getTransport()
			.request("session.setThinkingLevel", { sessionId, level })
			.catch((error: unknown) => {
				if (live()?.thinkingLevel === level)
					useAppStore.getState().setThinkingLevel(sessionId, previous);
				failed(t("chat.view.effortChangeFailed"), error);
			});
	};

	const onSelectModel = ({ model: next, level }: ModelSelection): void => {
		const previous = live()?.model ?? model;
		useAppStore.getState().setCurrentModel(sessionId, next);
		getTransport()
			.request("session.setModel", { sessionId, model: next })
			.then(
				() => {
					if (level) onSelectThinking(level);
					refreshStats();
				},
				(error: unknown) => {
					if (previous && sameModel(live()?.model, next))
						useAppStore.getState().setCurrentModel(sessionId, previous);
					failed(t("chat.view.modelSwitchFailed", { model: next.name }), error);
				},
			);
	};

	const onAbort = (): void => {
		abortFlight(() => getTransport().request("session.abort", { sessionId, restoreQueue: true }))
			?.then(({ restoredQueue }) => {
				if (restoredQueue) restoreQueued(restoredQueue);
			})
			.catch((error: unknown) => failed(t("mobile.session.stopFailed"), error));
	};

	return (
		<ChatActionsContext.Provider value={chatActions}>
			<PendingExtUiContext.Provider value={pendingExtUi}>
				<InteractionStatesContext.Provider value={interactionContext}>
					<Screen
						title={session.title}
						below={
							<UsageBar
								stats={stats}
								open={usageOpen}
								onToggle={() => setUsageOpen((open) => !open)}
							>
								<ResourcesTool
									client={client}
									workspaceId={workspaceId}
									sessionId={sessionId}
									readOnly={readOnly}
									onOpenSubagent={onOpenSubagent}
								/>
								<SkillsTool
									client={client}
									project={project}
									workspaceId={workspaceId}
									sessionId={sessionId}
									streaming={isStreaming}
									readOnly={readOnly}
									otherAgentSkills={otherAgentSkills}
								/>
							</UsageBar>
						}
						back={{ label: backLabel, onBack }}
						titleAlign="start"
						action={
							chats.kind === "ready" && chats.value.length > 1 ? (
								<IconButton
									size="l"
									className="size-touch shrink-0"
									icon={RiHistoryLine}
									label={t("mobile.workspace.history")}
									data-testid="chat-switcher"
									onClick={onHistory}
								/>
							) : readOnly ? undefined : (
								<IconButton
									size="l"
									className="size-touch shrink-0"
									icon={RiChatNewLine}
									label={t("mobile.workspace.newChat")}
									data-testid="chat-new"
									loading={creating}
									disabled={!client || creating}
									onClick={startChat}
								/>
							)
						}
						footer={
							readOnly ? (
								<footer
									data-testid="read-only-note"
									className="flex items-center gap-8 border-t border-border-default bg-container-workspace-bg px-chat-gutter pt-12 pb-safe-bottom text-text-muted tr-text-metadata"
								>
									<RiEyeLine aria-hidden className="size-16 shrink-0" />
									<span className="pb-12">{t("mobile.session.readOnly")}</span>
								</footer>
							) : (
								<footer className="@container bg-container-workspace-bg pb-safe-bottom">
									{createFailure ? (
										<FailureLine>
											{t("mobile.workspace.newChatFailed", { reason: createFailure })}
										</FailureLine>
									) : null}
									{failure ? <FailureLine>{failure}</FailureLine> : null}
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
											onDismiss={() => useAppStore.getState().dismissSessionNotice(sessionId)}
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
									<div className="flex min-w-0 items-center border-border-muted border-t px-chat-gutter pt-8">
										<ModelSheet
											ref={pickerRef}
											models={catalog}
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
										awaitingResponse={awaitingToolCallId != null}
										growthLimit="compact"
										divider={false}
										commands={commands}
										templatePending={false}
										mentionCandidates={[]}
										recentPrompts={NO_PROMPTS}
										models={catalog}
										modelsRefreshing={modelsRefreshing}
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
										onAbort={onAbort}
									/>
								</footer>
							)
						}
					>
						<div
							className={cn("@container flex flex-col gap-8 px-chat-gutter py-16", TOUCH_BUTTONS)}
						>
							{loadError ? (
								<Notice text={t("mobile.list.failed", { reason: loadError })} alert />
							) : runtime === undefined ? (
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
							{status_ ? <StreamIndicator status={status_} /> : null}
							<div ref={bottom} />
						</div>
					</Screen>
				</InteractionStatesContext.Provider>
			</PendingExtUiContext.Provider>
		</ChatActionsContext.Provider>
	);
}
