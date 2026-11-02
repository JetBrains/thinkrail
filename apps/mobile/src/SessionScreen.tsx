import { type ChatActions, ChatActionsContext } from "@thinkrail/chat-ui/ChatActions";
import {
	Composer,
	type ComposerSubmitDisposition,
	type SubmitBehavior,
} from "@thinkrail/chat-ui/Composer";
import { messagesToRuntime } from "@thinkrail/chat-ui/hydrate";
import {
	deriveInteractionStates,
	InteractionStatesContext,
} from "@thinkrail/chat-ui/interactionState";
import type { ModelSelection } from "@thinkrail/chat-ui/ModelEffortPicker";
import { deriveMessageActions } from "@thinkrail/chat-ui/messageActions";
import type { ModelPreferences } from "@thinkrail/chat-ui/modelPreferences";
import { deriveRows } from "@thinkrail/chat-ui/rows";
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
import type { RemoteSessionsController } from "@thinkrail/remote-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader, Notice, Screen } from "./layout";
import { useHostRequest } from "./useHostRequest";

export interface OpenSession {
	hostKey: string;
	sessionId: string;
	workspaceId: string;
	title: string;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
}

const REFRESH_COALESCE_MS = 400;
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
	backLabel,
	onBack,
}: {
	session: OpenSession;
	state: SessionState | undefined;
	controller: RemoteSessionsController;
	backLabel: string;
	onBack: () => void;
}) {
	const t = useT();
	const { hostKey, sessionId, workspaceId } = session;
	const client = controller.clientFor(hostKey);
	const [messages, setMessages] = useState<TranscriptMessage[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [model, setModel] = useState(session.model);
	const [thinkingLevel, setThinkingLevel] = useState(session.thinkingLevel);
	const [sendError, setSendError] = useState<string | null>(null);
	const bottom = useRef<HTMLDivElement>(null);
	const isStreaming = state?.execution === "running";

	const models = useHostRequest<WireModel[]>(client, "model.list", {});
	const commands = useHostRequest<SlashCommandInfo[]>(client, "session.getCommands", { sessionId });

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
	const interactionContext = useMemo(
		() => ({
			states: runtime
				? deriveInteractionStates(runtime.turns, runtime.toolResponses, runtime.toolResults)
				: {},
			focusScope: {},
		}),
		[runtime],
	);
	const chatActions = useMemo<ChatActions | null>(
		() =>
			client && {
				cancelAutomaticReveal: () => {},
				focusComposer: () => {},
				openSubagentTranscript: () => {},
				respondToTool: (toolCallId, response) =>
					client
						.request("session.respondToTool", { sessionId, toolCallId, response })
						.then(() => undefined),
				resultOpener: () => undefined,
				revealChatElement: (element) => element.scrollIntoView({ block: "nearest" }),
			},
		[client, sessionId],
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
		<Screen
			title={session.title}
			back={{ label: backLabel, onBack }}
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
					<Composer
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
			<ChatActionsContext.Provider value={chatActions}>
				<InteractionStatesContext.Provider value={interactionContext}>
					<div className="@container flex flex-col gap-8 px-chat-gutter py-16">
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
				</InteractionStatesContext.Provider>
			</ChatActionsContext.Provider>
		</Screen>
	);
}
