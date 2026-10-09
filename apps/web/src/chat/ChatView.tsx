import {
	type PromptHit,
	type QueueLane,
	type SessionQueueContent,
	sameModel,
	type TemplateInfo,
	type ThinkingLevel,
} from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { Popover, PopoverAnchor, PopoverTrigger } from "@thinkrail/ui/popover";
import { useCallback, useEffect, useInsertionEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useNow } from "@/components/useNow";
import { registerWebExtensions } from "@/extensions";
import { type ParsedTemplate, templateToSlashCommand, useTemplateCommandPicker } from "@/prompt";
import {
	EMPTY_RUNTIME,
	SettingsSection,
	selectAwaitingAsk,
	selectCanRenameChat,
	selectCatalogModel,
	selectCompactionTurnIds,
	selectSkillsStale,
	selectWorkspaceById,
	toast,
	useAppStore,
} from "@/store";
import { errorText, getTransport } from "@/transport";
import { ChatHeader } from "./ChatHeader";
import { ChatPlanContent, ChatPlanStripContent } from "./ChatPlan";
import ChatTranscript, { type ChatTranscriptHandle } from "./ChatTranscript";
import {
	Composer,
	type ComposerHandle,
	type ComposerSubmitDisposition,
	type MentionCandidate,
	type SubmitBehavior,
} from "./Composer";
import { ExtUiDialog } from "./ExtUiDialog";
import { HistoryOverlay } from "./HistoryOverlay";
import type { ModelSelection } from "./ModelEffortPicker";
import {
	compactSubmissionError,
	mergeNativeChatCommands,
	parseNativeChatCommand,
	prepareNameChatCommand,
} from "./nativeCommands";
import { hostSessionGlance } from "./planView";
import { QueueStrip } from "./QueueStrip";
import { deriveRecentPrompts } from "./recentPrompts";
import { CommandLogView, ResourcesButton, ResourcesDock, ResourcesInspector } from "./resources";
import { SkillsDialog } from "./SkillsDialog";
import { SubagentTranscriptDialog, SubagentTranscriptPane } from "./SubagentTranscriptDialog";
import { TemplateEditorDialog } from "./TemplateEditorDialog";
import { useChatResources, useCommandLog } from "./useChatResources";
import { useModelCatalog } from "./useModelCatalog";
import { useModelPreferences } from "./useModelPreferences";
import { useSessionStats } from "./useSessionStats";
import "./tools/register";
import type { ChatAttachment } from "./types";
import { useChatTodos } from "./useChatTodos";
import { useHistorySearch } from "./useHistorySearch";

registerWebExtensions();

const TRY_AGAIN_PROMPT = "Try again.";

export default function ChatView({
	sessionId,
	workspaceId,
	onOpenFile,
}: {
	sessionId: string;
	workspaceId: string;
	onOpenFile?: ((path: string) => void) | undefined;
}) {
	const sessionExists = useAppStore((s) => s.sessions[sessionId] !== undefined);
	const isStreaming = useAppStore((s) => s.sessions[sessionId]?.isStreaming ?? false);
	const draft = useAppStore((s) => s.sessions[sessionId]?.draft ?? "");
	const queue = useAppStore((s) => s.sessions[sessionId]?.queue ?? EMPTY_RUNTIME.queue);
	const sessionModel = useAppStore((s) => s.sessions[sessionId]?.model ?? null);
	const thinkingLevel = useAppStore(
		(s) => s.sessions[sessionId]?.thinkingLevel ?? EMPTY_RUNTIME.thinkingLevel,
	);
	const pendingExtUi = useAppStore((s) => s.sessions[sessionId]?.pendingExtUi ?? null);
	const extUiStatus = useAppStore(
		(s) => s.sessions[sessionId]?.extUiStatus ?? EMPTY_RUNTIME.extUiStatus,
	);
	const extUiWidget = useAppStore(
		(s) => s.sessions[sessionId]?.extUiWidget ?? EMPTY_RUNTIME.extUiWidget,
	);
	const commands = useAppStore((s) => s.sessions[sessionId]?.commands ?? EMPTY_RUNTIME.commands);
	const stats = useAppStore((s) => s.sessions[sessionId]?.stats ?? null);
	const statsRefreshTick = useAppStore((s) => s.sessions[sessionId]?.statsRefreshTick ?? 0);
	const syncedConnectionGeneration = useAppStore(
		(s) => s.sessions[sessionId]?.syncedConnectionGeneration ?? 0,
	);
	const hostState = useAppStore((s) => s.sessions[sessionId]?.hostState ?? null);
	const awaitingAsk = useAppStore((s) => selectAwaitingAsk(s, sessionId));
	const recentPrompts = useAppStore(
		useShallow((s) => deriveRecentPrompts(s.sessions[sessionId]?.turns ?? [])),
	);

	const status = useAppStore((s) => s.status);
	const connectionGeneration = useAppStore((s) => s.connectionGeneration);
	const canRenameChat = useAppStore(selectCanRenameChat);
	const composerGrowthLimit = useAppStore((state) => state.composerGrowthLimit);
	const chatLineWidth = useAppStore((state) => state.chatLineWidth);
	const chatLineWidthBounded = useAppStore((state) => state.chatLineWidthBounded);
	const chatMessageOrder = useAppStore((state) => state.chatMessageOrder);
	const { models, refreshing: modelsRefreshing, refresh: onRefreshModels } = useModelCatalog();
	const modelPreferences = useModelPreferences(models);
	const projectId = useAppStore(
		(s) =>
			Object.values(s.workspaces)
				.flat()
				.find((w) => w.id === workspaceId)?.projectId,
	);
	const [skillsOpen, setSkillsOpen] = useState(false);
	const skillsStale = useAppStore((s) => selectSkillsStale(s, workspaceId, sessionId));
	const workspaceRoot = useAppStore(
		(s) => selectWorkspaceById(s, workspaceId)?.worktreePath ?? undefined,
	);
	const workspaces = useAppStore((s) => s.workspaces);
	const workspaceNames = useMemo(() => {
		const map: Record<string, string> = {};
		for (const list of Object.values(workspaces)) {
			for (const w of list) map[w.id] = w.name;
		}
		return map;
	}, [workspaces]);

	const currentModel = selectCatalogModel(models, sessionModel) ?? sessionModel;
	const refreshStats = useSessionStats({
		sessionId,
		statsRefreshTick,
		syncedConnectionGeneration,
		status,
		connectionGeneration,
		enabled: sessionExists,
	});

	const [mentionQuery, setMentionQuery] = useState<string | null>(null);
	const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
	const plan = useChatTodos(workspaceId, sessionId);
	const [planOpen, setPlanOpen] = useState(false);
	const [slashActive, setSlashActive] = useState(false);
	const [templates, setTemplates] = useState<TemplateInfo[]>([]);
	const [templatesEmpty, setTemplatesEmpty] = useState(false);
	const [saveAsTemplateHit, setSaveAsTemplateHit] = useState<PromptHit | null>(null);
	const [transcriptSelection, setTranscriptSelection] = useState<{
		workspaceId: string;
		sessionId: string;
		childSessionId: string;
	} | null>(null);
	const transcriptChildId =
		transcriptSelection?.workspaceId === workspaceId && transcriptSelection.sessionId === sessionId
			? transcriptSelection.childSessionId
			: null;
	const setTranscriptChildId = useCallback(
		(childSessionId: string | null) =>
			setTranscriptSelection(childSessionId ? { workspaceId, sessionId, childSessionId } : null),
		[workspaceId, sessionId],
	);
	const composerRef = useRef<ComposerHandle>(null);
	const transcriptRef = useRef<ChatTranscriptHandle>(null);
	const resources = useChatResources(workspaceId, sessionId);
	const resourcesTrigger = useRef<HTMLButtonElement>(null);
	const [stopAllOpen, setStopAllOpen] = useState(false);
	const [inspector, setInspector] = useState<{
		workspaceId: string;
		sessionId: string;
		open: boolean;
		selectedId: string | null;
	} | null>(null);
	const inspectorOpen =
		inspector?.workspaceId === workspaceId && inspector.sessionId === sessionId && inspector.open;
	const inspectorSelectedId =
		inspector?.workspaceId === workspaceId && inspector.sessionId === sessionId
			? inspector.selectedId
			: null;
	const openInspector = useCallback(
		(selectedId?: string) =>
			setInspector((previous) => ({
				workspaceId,
				sessionId,
				open: true,
				selectedId:
					selectedId ??
					(previous?.workspaceId === workspaceId && previous.sessionId === sessionId
						? previous.selectedId
						: null),
			})),
		[workspaceId, sessionId],
	);
	const setInspectorOpen = useCallback(
		(open: boolean) => {
			if (open) openInspector();
			else setInspector((previous) => (previous ? { ...previous, open: false } : previous));
		},
		[openInspector],
	);
	const selectResource = useCallback(
		(selectedId: string) =>
			setInspector((previous) =>
				previous?.workspaceId === workspaceId && previous.sessionId === sessionId
					? { ...previous, selectedId }
					: { workspaceId, sessionId, open: true, selectedId },
			),
		[workspaceId, sessionId],
	);
	const selectedCommandId =
		inspectorOpen &&
		inspectorSelectedId &&
		[...resources.groups.commands, ...resources.groups.finishedCommands].some(
			(command) => command.id === inspectorSelectedId,
		)
			? inspectorSelectedId
			: null;
	const selectedSubagentId =
		inspectorOpen &&
		inspectorSelectedId &&
		[...resources.groups.subagents, ...resources.groups.finishedSubagents].some(
			(child) => child.childSessionId === inspectorSelectedId,
		)
			? inspectorSelectedId
			: null;
	const commandLog = useCommandLog(workspaceId, sessionId, selectedCommandId);
	const now = useNow();
	const returnToResources = (event: Event) => {
		event.preventDefault();
		if (resourcesTrigger.current) resourcesTrigger.current.focus();
		else composerRef.current?.refocus();
	};
	useEffect(() => {
		if (!resources.knownUnsupported) return;
		setInspector(null);
		setStopAllOpen(false);
	}, [resources.knownUnsupported]);

	const stillRunning = useMemo(
		() =>
			resources.visible && resources.authoritative && resources.groups.activeCount > 0
				? { count: resources.groups.activeCount, onOpen: () => openInspector() }
				: undefined,
		[resources.visible, resources.authoritative, resources.groups.activeCount, openInspector],
	);

	const chatViewRef = useCallback(
		(element: HTMLDivElement | null) => {
			if (element) {
				element.style.setProperty(
					"--chat-transcript-width",
					`calc(${chatLineWidth}ch + var(--space-24))`,
				);
			}
		},
		[chatLineWidth],
	);

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
	useEffect(() => {
		useAppStore.getState().setChatObscured(sessionId, historyState.open);
		return () => useAppStore.getState().setChatObscured(sessionId, false);
	}, [historyState.open, sessionId]);

	useEffect(() => {
		getTransport()
			.request("session.getCommands", { sessionId })
			.then((c) => useAppStore.getState().setCommands(sessionId, c))
			.catch(() => {});
	}, [sessionId]);

	useEffect(() => {
		if (!slashActive) return;
		let cancelled = false;
		getTransport()
			.request("template.list", { workspaceId })
			.then((res) => {
				if (cancelled) return;
				setTemplates(res.templates);
				setTemplatesEmpty(res.templates.length === 0);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [slashActive, workspaceId]);

	const mergedCommands = useMemo(
		() =>
			mergeNativeChatCommands(
				[
					...commands.filter((command) => command.source !== "prompt"),
					...templates.map(templateToSlashCommand),
				],
				canRenameChat,
			),
		[canRenameChat, commands, templates],
	);

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

	const liveRuntime = () => useAppStore.getState().sessions[sessionId];
	const pairSelection = useRef(0);

	const requestLevel = useCallback(
		(level: ThinkingLevel, previous: ThinkingLevel) =>
			getTransport()
				.request("session.setThinkingLevel", { sessionId, level })
				.catch((error: unknown) => {
					if (useAppStore.getState().sessions[sessionId]?.thinkingLevel === level) {
						useAppStore.getState().setThinkingLevel(sessionId, previous);
					}
					toast.error(errorText(error), "Couldn't change the effort level");
				}),
		[sessionId],
	);

	useEffect(() => {
		if (!currentModel || currentModel.thinkingLevels.includes(thinkingLevel)) return;
		let cancelled = false;
		getTransport()
			.request("model.clampThinking", {
				provider: currentModel.provider,
				id: currentModel.id,
				level: thinkingLevel,
			})
			.then((clamped) => {
				if (cancelled || clamped.level === thinkingLevel) return;
				pairSelection.current += 1;
				useAppStore.getState().setThinkingLevel(sessionId, clamped.level);
				return requestLevel(clamped.level, thinkingLevel);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [currentModel, thinkingLevel, sessionId, requestLevel]);

	const onSelectThinking = (level: ThinkingLevel) => {
		if (level === thinkingLevel) return;
		pairSelection.current += 1;
		useAppStore.getState().setThinkingLevel(sessionId, level);
		void requestLevel(level, thinkingLevel);
	};

	const onSelectModel = ({ model, level }: ModelSelection) => {
		if (sameModel(model, currentModel)) {
			if (level) onSelectThinking(level);
			return;
		}
		const previous = { model: sessionModel, level: thinkingLevel };
		const selection = ++pairSelection.current;
		const superseded = () => selection !== pairSelection.current;
		useAppStore.getState().setCurrentModel(sessionId, model);
		if (level) useAppStore.getState().setThinkingLevel(sessionId, level);
		getTransport()
			.request("session.setModel", { sessionId, model })
			.then(
				() => (level && !superseded() ? requestLevel(level, previous.level) : undefined),
				(error: unknown) => {
					if (sameModel(liveRuntime()?.model, model)) {
						if (previous.model) useAppStore.getState().setCurrentModel(sessionId, previous.model);
						if (level && !superseded()) {
							useAppStore.getState().setThinkingLevel(sessionId, previous.level);
						}
					}
					toast.error(errorText(error), `Couldn't switch to ${model.name}`);
				},
			)
			.then(() => refreshStats());
	};

	const restoreTextToDraft = (text: string) => {
		if (!text.trim()) return;
		const current = useAppStore.getState().sessions[sessionId]?.draft ?? "";
		const combined = [text, current].filter((t) => t.trim()).join("\n\n");
		useAppStore.getState().setChatDraft(sessionId, combined);
		composerRef.current?.refocus();
	};

	const restoreQueueContentToDraft = (content: SessionQueueContent): void => {
		const messages = [...content.steering, ...content.followUp];
		restoreTextToDraft(messages.map((message) => message.text).join("\n\n"));
		const images = messages.flatMap((message) => message.images ?? []);
		composerRef.current?.restoreAttachments(
			images.map((image, index) => ({
				name: `queued-image-${index + 1}`,
				content: image,
			})),
		);
	};

	const drainQueueToDraft = async (): Promise<void> => {
		const content = await getTransport().request("session.clearQueue", {
			sessionId,
			requireTextOnly: true,
		});
		restoreQueueContentToDraft(content);
	};

	const performCompact = (instructions?: string) => {
		const observedTurnIds = selectCompactionTurnIds(useAppStore.getState(), sessionId);
		void drainQueueToDraft()
			.then(() =>
				getTransport().request("session.compact", {
					sessionId,
					...(instructions ? { instructions } : {}),
				}),
			)
			.catch((err) =>
				useAppStore
					.getState()
					.appendCompactionFailureUnlessObserved(sessionId, observedTurnIds, errorText(err)),
			);
	};

	const performRename = (title: string) => {
		void getTransport()
			.request("session.rename", { workspaceId, sessionId, title })
			.catch((err) => useAppStore.getState().appendErrorTurn(sessionId, errorText(err)));
	};

	const performSend = (
		text: string,
		attachments: ChatAttachment[],
		behavior: Exclude<SubmitBehavior, "interrupt">,
	) => {
		const queued = behavior !== "send";
		if (!queued && (text || attachments.length > 0)) {
			transcriptRef.current?.armImmediateTurn();
			useAppStore.getState().appendUserMessage(sessionId, text, attachments);
		}
		const images = attachments.map((a) => a.content);
		const params = { sessionId, text, ...(images.length > 0 ? { images } : {}) };
		const method =
			behavior === "steer"
				? "session.steer"
				: behavior === "followUp"
					? "session.followUp"
					: "session.prompt";
		getTransport()
			.request(method, params)
			.catch((err) => {
				useAppStore.getState().appendErrorTurn(sessionId, errorText(err));
				if (queued) restoreTextToDraft(text);
				else {
					const streaming = useAppStore.getState().sessions[sessionId]?.isStreaming ?? false;
					transcriptRef.current?.cancelImmediateTurn(streaming);
				}
			});
	};

	const onSubmit = (
		text: string,
		attachments: ChatAttachment[],
		behavior: SubmitBehavior,
	): ComposerSubmitDisposition => {
		const nativeCommand = parseNativeChatCommand(text, canRenameChat);
		if (nativeCommand?.kind === "compact") {
			const submissionError = compactSubmissionError(
				attachments.length > 0,
				queue.hasImages === true,
			);
			if (submissionError) return { accepted: false, reason: submissionError };
			performCompact(nativeCommand.instructions);
			return { accepted: true };
		}
		if (nativeCommand?.kind === "name") {
			const prepared = prepareNameChatCommand(nativeCommand.title, attachments.length > 0);
			if ("reason" in prepared) return { accepted: false, reason: prepared.reason };
			performRename(prepared.title);
			return { accepted: true };
		}
		if (behavior !== "interrupt") {
			performSend(text, attachments, behavior);
			return { accepted: true };
		}
		getTransport()
			.request("session.abort", { sessionId })
			.then(() => performSend(text, attachments, "send"))
			.catch((err) => {
				useAppStore.getState().appendErrorTurn(sessionId, errorText(err));
				restoreTextToDraft(text);
			});
		return { accepted: true };
	};

	const removeQueued = (kind: QueueLane, index: number) =>
		getTransport().request("session.removeQueued", { sessionId, kind, index });

	const onEditQueued = (kind: QueueLane, index: number) =>
		void removeQueued(kind, index)
			.then(({ removed }) => {
				if (removed === null) return;
				restoreQueueContentToDraft({ steering: [removed], followUp: [] });
			})
			.catch(() => {});

	const onRemoveQueued = (kind: QueueLane, index: number) =>
		void removeQueued(kind, index).catch(() => {});

	const onAbort = () => {
		void getTransport()
			.request("session.abort", { sessionId, restoreQueue: true })
			.then(({ restoredQueue }) => {
				if (restoredQueue) restoreQueueContentToDraft(restoredQueue);
			})
			.catch(() => {});
	};

	const onHistoryOpen = () => openOverlay(draft);

	const onManageTemplates = () => useAppStore.getState().openSettings(SettingsSection.Templates);

	const onDismissHistory = () => {
		closeHistory();
		composerRef.current?.refocus();
	};

	const onInsertHit = (hit: PromptHit) => {
		composerRef.current?.insertText(hit.text);
		closeHistory();
	};

	const onInsertAndSendHit = (hit: PromptHit) => {
		composerRef.current?.insertAndSubmit(hit.text, isStreaming ? "followUp" : "send");
		closeHistory();
	};

	const onSaveAsTemplateHit = (hit: PromptHit) => {
		closeHistory();
		setSaveAsTemplateHit(hit);
	};

	const onDeleteHistoryChat = async (targetWorkspaceId: string, targetSessionId: string) => {
		try {
			await getTransport().request("session.delete", {
				workspaceId: targetWorkspaceId,
				sessionId: targetSessionId,
			});
			closeHistory();
			useAppStore.getState().deleteChat(targetWorkspaceId, targetSessionId);
		} catch (err) {
			toast.error(errorText(err), "Couldn't delete the chat");
		}
	};

	const loadTemplate = useCallback(
		(name: string) => getTransport().request("template.get", { workspaceId, name }),
		[workspaceId],
	);
	const applyTemplate = useCallback(
		(template: ParsedTemplate) => composerRef.current?.insertTemplate(template),
		[],
	);
	const { pending: templatePending, pick: onPickTemplate } = useTemplateCommandPicker({
		draft,
		contextKey: `${workspaceId}:${sessionId}`,
		load: loadTemplate,
		onApply: applyTemplate,
	});

	const historyOpenRequest = useAppStore((s) => s.historyOpenRequest);
	const historyOverlayOpen = historyState.open;
	useEffect(() => {
		if (historyOpenRequest?.sessionId !== sessionId) return;
		if (useAppStore.getState().historyOpenRequest !== historyOpenRequest) return;
		useAppStore.getState().clearHistoryOpen();
		if (historyOverlayOpen) cycleScope();
		else composerRef.current?.openHistory();
	}, [historyOpenRequest, sessionId, historyOverlayOpen, cycleScope]);

	const planGlanceState = useMemo(
		() =>
			hostSessionGlance(
				hostState,
				awaitingAsk ? "waiting_question" : isStreaming ? "working" : "waiting",
			),
		[awaitingAsk, hostState, isStreaming],
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
	const focusComposer = useCallback(() => composerRef.current?.refocus(), []);
	// Keep a stable `onTryAgain` identity (it is passed to every transcript row) while always calling the
	// latest `performSend` closure.
	const performSendRef = useRef(performSend);
	useInsertionEffect(() => {
		performSendRef.current = performSend;
	});
	const onTryAgain = useCallback(() => performSendRef.current(TRY_AGAIN_PROMPT, [], "send"), []);

	return (
		<div
			ref={chatViewRef}
			onPointerDownCapture={(event) => {
				const target = event.target;
				if (target instanceof Element && target.closest('[data-testid="history-overlay"]')) return;
				useAppStore.getState().noteDirectChatActivation(sessionId);
			}}
			data-testid="chat-view"
			data-line-width-bounded={chatLineWidthBounded}
			data-message-order={chatMessageOrder}
			className="flex h-full min-h-0 min-w-0 flex-col bg-container-workspace-bg [container-type:size]"
		>
			<Popover
				open={planOpen}
				onOpenChange={(next) => {
					if (next && !planOpen) plan.notifyOpened("popup");
					setPlanOpen(next);
				}}
			>
				<PopoverAnchor asChild>
					<div className="shrink-0">
						<ChatHeader
							resources={
								resources.visible ? (
									<ResourcesButton
										ref={resourcesTrigger}
										activeCount={resources.authoritative ? resources.groups.activeCount : null}
										open={inspectorOpen}
										onClick={() => setInspectorOpen(!inspectorOpen)}
									/>
								) : null
							}
							stats={stats}
							statusEntries={Object.entries(extUiStatus)}
							left={
								plan.data ? (
									<PopoverTrigger asChild>
										<button
											type="button"
											data-testid="chat-plan-toggle"
											data-open={planOpen}
											className="flex min-w-0 max-w-full items-center gap-4 overflow-clip whitespace-nowrap text-text-muted tr-text-metadata hover:text-text-default"
										>
											<ChatPlanStripContent plan={plan} open={planOpen} glance={planGlanceState} />
										</button>
									</PopoverTrigger>
								) : null
							}
							skillsStale={skillsStale}
							{...(projectId ? { onOpenSkills: () => setSkillsOpen(true) } : {})}
						/>
					</div>
				</PopoverAnchor>
				<ChatPlanContent plan={plan} glance={planGlanceState} />
			</Popover>
			<ChatTranscript
				ref={transcriptRef}
				sessionId={sessionId}
				workspaceId={workspaceId}
				onOpenFile={onOpenFile}
				workspaceRoot={workspaceRoot}
				focusComposer={focusComposer}
				openSubagentTranscript={setTranscriptChildId}
				onTryAgain={onTryAgain}
				historyOpen={historyState.open}
				stillRunning={stillRunning}
				resourcesOverlay={
					resources.visible ? (
						<ResourcesInspector
							open={inspectorOpen}
							onOpenChange={setInspectorOpen}
							onCloseAutoFocus={returnToResources}
							{...resources.groups}
							now={now}
							authoritative={resources.authoritative}
							loading={resources.loading}
							stale={resources.stale}
							error={resources.projection?.error ?? null}
							actions={resources.actions}
							selectedId={inspectorSelectedId}
							onSelect={selectResource}
							onRetry={resources.retry}
							onStopCommand={resources.stopCommand}
							onStopSubagent={resources.stopSubagent}
							onStopAll={() => setStopAllOpen(true)}
							detail={
								selectedCommandId ? (
									<CommandLogView {...commandLog} onRetry={commandLog.retry} />
								) : selectedSubagentId ? (
									<SubagentTranscriptPane
										key={selectedSubagentId}
										workspaceId={workspaceId}
										parentSessionId={sessionId}
										childSessionId={selectedSubagentId}
									/>
								) : null
							}
						/>
					) : null
				}
			/>
			{widgetEntries.length > 0 ? (
				<div className="shrink-0 border-border-default border-t bg-container-elevated-bg px-12 py-4 text-text-muted tr-text-metadata">
					{widgetEntries.map(([key, lines]) => (
						<div key={key}>{lines.join(" ")}</div>
					))}
				</div>
			) : null}
			<QueueStrip queue={queue} onEdit={onEditQueued} onRemove={onRemoveQueued} />
			{resources.visible && !inspectorOpen ? (
				<ResourcesDock
					commands={resources.groups.commands}
					subagents={resources.groups.subagents}
					now={now}
					authoritative={resources.authoritative}
					actions={resources.actions}
					onInspect={openInspector}
					onStopCommand={resources.stopCommand}
					onStopSubagent={resources.stopSubagent}
				/>
			) : null}
			<div className="relative shrink-0">
				<HistoryOverlay
					state={historyState}
					workspaceNames={workspaceNames}
					onQueryChange={setQuery}
					onSetScope={setScope}
					onToggleStage={toggleStage}
					onMoveSelection={moveSelection}
					onClose={onDismissHistory}
					onInsert={onInsertHit}
					onInsertAndSend={onInsertAndSendHit}
					onOpenMessage={openMessage}
					onSaveAsTemplate={onSaveAsTemplateHit}
					onDeleteChat={(wsId, id) => void onDeleteHistoryChat(wsId, id)}
				/>
				<Composer
					ref={composerRef}
					value={draft}
					onChange={(v) => useAppStore.getState().setChatDraft(sessionId, v)}
					isStreaming={isStreaming}
					growthLimit={composerGrowthLimit}
					commands={mergedCommands}
					templatePending={templatePending}
					mentionCandidates={mentionCandidates}
					recentPrompts={recentPrompts}
					models={models}
					modelsRefreshing={modelsRefreshing}
					onRefreshModels={onRefreshModels}
					currentModel={currentModel}
					thinkingLevel={thinkingLevel}
					modelPreferences={modelPreferences}
					onMentionQuery={onMentionQuery}
					onSlashActive={setSlashActive}
					onSelectModel={onSelectModel}
					onSelectThinking={onSelectThinking}
					onSubmit={onSubmit}
					onAbort={onAbort}
					onHistoryOpen={onHistoryOpen}
					onPickTemplate={onPickTemplate}
					onManageTemplates={onManageTemplates}
					templatesEmpty={templatesEmpty}
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
			<Dialog open={stopAllOpen} onOpenChange={setStopAllOpen}>
				<DialogContent onCloseAutoFocus={returnToResources}>
					<DialogTitle>Stop all subagents?</DialogTitle>
					<DialogDescription>
						Stop {resources.groups.subagents.length} active subagents in this chat? The main chat
						and future delegation are unaffected.
					</DialogDescription>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setStopAllOpen(false)}>
							Cancel
						</Button>
						<Button
							data-testid="resources-stop-all-confirm"
							disabled={
								!resources.authoritative ||
								resources.groups.subagents.length === 0 ||
								resources.actions.all?.pending
							}
							onClick={() => {
								resources.stopAll();
								setStopAllOpen(false);
							}}
						>
							Stop {resources.groups.subagents.length} subagents
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			{transcriptChildId ? (
				<SubagentTranscriptDialog
					key={`${workspaceId}:${sessionId}:${transcriptChildId}`}
					workspaceId={workspaceId}
					parentSessionId={sessionId}
					childSessionId={transcriptChildId}
					onOpenChange={(open) => {
						if (!open) setTranscriptChildId(null);
					}}
				/>
			) : null}
			{projectId ? (
				<SkillsDialog
					projectId={projectId}
					workspace={{
						workspaceId,
						sessionId,
						streaming: isStreaming,
						stale: skillsStale,
						onReloaded: (syncedTick) =>
							useAppStore.getState().markSkillsSynced(sessionId, syncedTick),
					}}
					open={skillsOpen}
					onOpenChange={setSkillsOpen}
				/>
			) : null}
		</div>
	);
}
