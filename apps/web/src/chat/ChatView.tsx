import { RiArrowDownLine as ArrowDown } from "@remixicon/react";
import type {
	AskUserQuestionResult,
	PromptHit,
	QueueLane,
	SessionQueueContent,
	SlashCommandInfo,
	TemplateInfo,
	ThinkingLevel,
	WireModel,
} from "@thinkrail/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Popover, PopoverAnchor, PopoverTrigger } from "@/components/ui/popover";
import {
	EMPTY_RUNTIME,
	SettingsSection,
	selectCatalogModel,
	selectCompactionTurnIds,
	selectSkillsStale,
	selectWorkspaceById,
	specPathMatcher,
	toast,
	useAppStore,
} from "@/store";
import { errorText, getTransport } from "@/transport";
import { AskStatesContext, deriveAskStates } from "./askState";
import { type ChatActions, ChatActionsContext } from "./ChatActions";
import { ChatHeader } from "./ChatHeader";
import { ChatPlanContent, ChatPlanStripContent } from "./ChatPlan";
import {
	Composer,
	type ComposerHandle,
	type ComposerSubmitDisposition,
	type MentionCandidate,
	type SubmitBehavior,
} from "./Composer";
import { ExtUiDialog } from "./ExtUiDialog";
import { HistoryOverlay } from "./HistoryOverlay";
import {
	compactSubmissionError,
	mergeNativeChatCommands,
	parseNativeChatCommand,
} from "./nativeCommands";
import { planGlance } from "./planView";
import { QueueStrip } from "./QueueStrip";
import { type ChatRow, deriveRows, rowIndexForTurn } from "./rows";
import { SkillsDialog } from "./SkillsDialog";
import { StreamIndicator, type StreamStatus, streamStatus } from "./StreamIndicator";
import { parseTemplateSlots } from "./slotSession";
import { TemplateEditorDialog } from "./TemplateEditorDialog";
import { shouldApplyTemplatePick } from "./templatePick";
import { stripFrontmatter } from "./templateText";
import { useModelCatalog } from "./useModelCatalog";
import "./tools/register";
import { ChatTurnView } from "./turns";
import type { ChatAttachment, ChatTurn } from "./types";
import { useChatScroll } from "./useChatScroll";
import { useChatTodos } from "./useChatTodos";
import { useHistorySearch } from "./useHistorySearch";

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

type ChatListContext = { status: StreamStatus | null };

function StreamFooter({ context }: { context: ChatListContext }) {
	if (!context.status) return null;
	return (
		<div className="mx-auto max-w-3xl px-12 pb-8">
			<StreamIndicator status={context.status} />
		</div>
	);
}

const CHAT_LIST_COMPONENTS = { Footer: StreamFooter };

export default function ChatView({
	sessionId,
	workspaceId,
}: {
	sessionId: string;
	workspaceId: string;
}) {
	const runtime = useAppStore((s) => s.sessions[sessionId]) ?? EMPTY_RUNTIME;
	const { models, refreshing: modelsRefreshing, refresh: onRefreshModels } = useModelCatalog();
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
	const specNodes = useAppStore((s) => s.specsByWorkspace[workspaceId]);
	const isSpec = useMemo(() => specPathMatcher(specNodes ?? []), [specNodes]);
	const {
		turns,
		toolResults,
		isStreaming,
		currentAssistantId,
		stats,
		commands,
		draft,
		queue,
		pendingExtUi,
		extUiStatus,
		extUiWidget,
		model: sessionModel,
		thinkingLevel,
	} = runtime;

	const currentModel = selectCatalogModel(models, sessionModel) ?? sessionModel;

	const rows = useMemo(
		() => deriveRows(turns, toolResults, isStreaming, isSpec),
		[turns, toolResults, isStreaming, isSpec],
	);

	const listContext = useMemo<ChatListContext>(() => {
		const last = turns[turns.length - 1];
		const status =
			isStreaming && last?.kind !== "retry" ? streamStatus(turns, currentAssistantId) : null;
		return { status };
	}, [turns, isStreaming, currentAssistantId]);

	const recentPrompts = useMemo(() => {
		const texts = turns
			.filter((t) => t.kind === "user")
			.map((t) => turnAnchorText(t))
			.filter(Boolean);
		return [...new Set(texts.reverse())];
	}, [turns]);

	const [mentionQuery, setMentionQuery] = useState<string | null>(null);
	const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
	const plan = useChatTodos(workspaceId, sessionId);
	const [planOpen, setPlanOpen] = useState(false);
	const [slashActive, setSlashActive] = useState(false);
	const [templates, setTemplates] = useState<TemplateInfo[]>([]);
	const [templatesEmpty, setTemplatesEmpty] = useState(false);
	const [saveAsTemplateHit, setSaveAsTemplateHit] = useState<PromptHit | null>(null);

	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const { followOutput, handleAtBottom, showScrollButton, scrollToBottom, containerProps } =
		useChatScroll(virtuosoRef);
	const composerRef = useRef<ComposerHandle>(null);
	const askFocusScope = useRef<object>({}).current;

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

	const chatLocationRequest = useAppStore((s) => s.chatLocationRequest);
	const [flashRowId, setFlashRowId] = useState<string | null>(null);

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
			mergeNativeChatCommands([
				...commands.filter((command) => command.source !== "prompt"),
				...templates.map(templateToCommand),
			]),
		[commands, templates],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `isStreaming` is the refetch trigger, not read
	useEffect(() => {
		getTransport()
			.request("session.getStats", { sessionId })
			.then((st) => useAppStore.getState().setStats(sessionId, st))
			.catch(() => {});
	}, [sessionId, isStreaming]);

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

	const performSend = (
		text: string,
		attachments: ChatAttachment[],
		behavior: Exclude<SubmitBehavior, "interrupt">,
	) => {
		const queued = behavior !== "send";
		if (!queued && (text || attachments.length > 0))
			useAppStore.getState().appendUserMessage(sessionId, text, attachments);
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
			});
	};

	const onSubmit = (
		text: string,
		attachments: ChatAttachment[],
		behavior: SubmitBehavior,
	): ComposerSubmitDisposition => {
		const nativeCommand = parseNativeChatCommand(text);
		if (nativeCommand) {
			const submissionError = compactSubmissionError(
				attachments.length > 0,
				queue.hasImages === true,
			);
			if (submissionError) return { accepted: false, reason: submissionError };
			performCompact(nativeCommand.instructions);
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

	const pickGeneration = useRef(0);
	const onPickTemplate = useCallback(
		(name: string) => {
			const generation = ++pickGeneration.current;
			const draftAtPick = useAppStore.getState().sessions[sessionId]?.draft ?? "";
			getTransport()
				.request("template.get", { workspaceId, name })
				.then((t) => {
					const apply = shouldApplyTemplatePick({
						generation,
						latestGeneration: pickGeneration.current,
						draftAtPick,
						currentDraft: useAppStore.getState().sessions[sessionId]?.draft ?? "",
					});
					if (!apply) return;
					const parsed = parseTemplateSlots(stripFrontmatter(t.content), t.argumentHint);
					composerRef.current?.insertTemplate(parsed);
				})
				.catch(() => {});
		},
		[workspaceId, sessionId],
	);

	useEffect(() => {
		if (
			!chatLocationRequest ||
			chatLocationRequest.workspaceId !== workspaceId ||
			chatLocationRequest.sessionId !== sessionId ||
			rows.length === 0
		) {
			return;
		}
		if (useAppStore.getState().chatLocationRequest !== chatLocationRequest) return;
		const { messageIndex, anchorText } = chatLocationRequest;
		const prefix = anchorText.slice(0, 40);
		const mappedId = runtime.turnIdByMessageIndex?.[messageIndex];
		const mapped = mappedId ? turns.find((t) => t.id === mappedId) : undefined;
		const target =
			mapped && turnAnchorText(mapped).includes(prefix)
				? mapped
				: turns.findLast((t) => turnAnchorText(t).includes(prefix));
		const index = target ? rowIndexForTurn(rows, target.id) : -1;
		if (index === -1) {
			toast.error("couldn't locate the message — the session may have changed");
			useAppStore.getState().clearChatLocation();
			return;
		}
		virtuosoRef.current?.scrollToIndex({ index, align: "center" });
		setFlashRowId(rows[index]?.id ?? null);
		useAppStore.getState().clearChatLocation();
	}, [chatLocationRequest, sessionId, rows, runtime.turnIdByMessageIndex, turns, workspaceId]);

	const historyOpenRequest = useAppStore((s) => s.historyOpenRequest);
	const historyOverlayOpen = historyState.open;
	useEffect(() => {
		if (historyOpenRequest?.sessionId !== sessionId) return;
		if (useAppStore.getState().historyOpenRequest !== historyOpenRequest) return;
		useAppStore.getState().clearHistoryOpen();
		if (historyOverlayOpen) cycleScope();
		else composerRef.current?.openHistory();
	}, [historyOpenRequest, sessionId, historyOverlayOpen, cycleScope]);

	useEffect(() => {
		if (flashRowId === null) return;
		const timer = setTimeout(() => setFlashRowId(null), 1600);
		return () => clearTimeout(timer);
	}, [flashRowId]);

	const onOpenChange = useCallback(
		(path: string) => {
			useAppStore.getState().requestChangesView(workspaceId, path);
		},
		[workspaceId],
	);

	const onOpenSpec = useCallback(
		(path: string) => {
			useAppStore.getState().requestSpecView(workspaceId, path);
		},
		[workspaceId],
	);

	const onReveal = useCallback(
		(tool: "specs" | "changes") => {
			useAppStore.getState().requestToolView(workspaceId, tool);
		},
		[workspaceId],
	);

	const askStates = useMemo(
		() => deriveAskStates(runtime.turns, runtime.askAnswers),
		[runtime.turns, runtime.askAnswers],
	);
	const askContext = useMemo(
		() => ({ states: askStates, focusScope: askFocusScope }),
		[askStates, askFocusScope],
	);

	const planGlanceState = useMemo(
		() => planGlance(isStreaming, askStates),
		[isStreaming, askStates],
	);

	const chatActions = useMemo<ChatActions>(
		() => ({
			answerQuestion: (toolCallId: string, result: AskUserQuestionResult) =>
				getTransport()
					.request("session.answerQuestion", { sessionId, toolCallId, result })
					.then(() => undefined),
			focusComposer: () => composerRef.current?.refocus(),
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
			<AskStatesContext.Provider value={askContext}>
				<div className="flex h-full min-h-0 flex-col bg-container-workspace-bg">
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
													className="flex min-w-0 max-w-full items-center gap-4 overflow-clip whitespace-nowrap text-text-muted tr-text-metadata hover:text-text-default"
												>
													<ChatPlanStripContent
														plan={plan}
														open={planOpen}
														glance={planGlanceState}
													/>
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
							className="min-h-0 flex-1 overflow-x-hidden"
							initialTopMostItemIndex={{ index: Math.max(rows.length - 1, 0), align: "end" }}
							followOutput={followOutput}
							atBottomStateChange={handleAtBottom}
							atBottomThreshold={50}
							computeItemKey={(_, row) => row.id}
							itemContent={(_, row) => (
								<div
									data-flash={row.id === flashRowId || undefined}
									className="mx-auto max-w-3xl rounded-[var(--radius-sm)] px-12 py-4 transition-colors data-[flash]:bg-primary-subtle"
								>
									<ChatTurnView
										row={row}
										workspaceRoot={workspaceRoot}
										onOpenSpec={onOpenSpec}
										onOpenChange={onOpenChange}
										onReveal={onReveal}
									/>
								</div>
							)}
						/>
						{showScrollButton ? (
							<button
								type="button"
								data-testid="scroll-to-bottom"
								onClick={scrollToBottom}
								className="-translate-x-1/2 absolute bottom-12 left-1/2 flex items-center gap-4 rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-8 py-4 text-text-muted tr-text-metadata shadow-[var(--shadow-md)] hover:bg-control-bg-hovered hover:text-text-default"
							>
								<ArrowDown className="size-12" />
								New messages
							</button>
						) : null}
					</div>
					{widgetEntries.length > 0 ? (
						<div className="shrink-0 border-border-default border-t bg-container-elevated-bg px-12 py-4 text-text-muted tr-text-metadata">
							{widgetEntries.map(([key, lines]) => (
								<div key={key}>{lines.join(" ")}</div>
							))}
						</div>
					) : null}
					<QueueStrip queue={queue} onEdit={onEditQueued} onRemove={onRemoveQueued} />
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
							commands={mergedCommands}
							mentionCandidates={mentionCandidates}
							recentPrompts={recentPrompts}
							models={models}
							modelsRefreshing={modelsRefreshing}
							onRefreshModels={onRefreshModels}
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
			</AskStatesContext.Provider>
		</ChatActionsContext.Provider>
	);
}
