import { RiHistoryLine } from "@remixicon/react";
import { type ChatActions, ChatActionsContext } from "@thinkrail/chat-ui/ChatActions";
import {
	Composer,
	type ComposerHandle,
	type ComposerSubmitDisposition,
	type SubmitBehavior,
} from "@thinkrail/chat-ui/Composer";
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
import { deriveRows, rowsHaveToolCall } from "@thinkrail/chat-ui/rows";
import { ChatTurnView } from "@thinkrail/chat-ui/turns";
import type { ChatAttachment } from "@thinkrail/chat-ui/types";
import {
	DEFAULT_CONFIG,
	type SessionEventPayload,
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
const NO_PROMPTS: string[] = [];

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
			if ((data as SessionEventPayload).sessionId !== sessionId || pending) return;
			pending = setTimeout(() => {
				pending = undefined;
				refresh();
			}, REFRESH_COALESCE_MS);
		});
		return () => {
			cancelled = true;
			if (pending) clearTimeout(pending);
			unsubscribe();
		};
	}, [client, sessionId, workspaceId]);

	const runtime = useMemo(
		() => (messages ? messagesToRuntime(messages, undefined, { idScope: sessionId }) : null),
		[messages, sessionId],
	);
	const rows = useMemo(
		() => (runtime ? deriveRows(runtime.turns, runtime.toolResults, isStreaming) : []),
		[runtime, isStreaming],
	);
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
										request("session.abort", { sessionId }).catch((error: unknown) =>
											setSendError(reasonOf(error)),
										);
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
											agentResponded={messageActions.agentRespondedByUserId.get(row.id) ?? false}
											isFinalAnswer={messageActions.finalAnswerRowIds.has(row.id)}
										/>
									</div>
								))
							)}
							<div ref={bottom} />
						</div>
					</Screen>
				</InteractionStatesContext.Provider>
			</PendingExtUiContext.Provider>
		</ChatActionsContext.Provider>
	);
}
