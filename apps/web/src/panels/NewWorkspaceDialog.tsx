import {
	RiBox3Line as Box,
	RiArrowDownSLine as ChevronDown,
	RiGitBranchLine as GitBranch,
	RiHome2Line as House,
	RiLoader4Line as Loader2,
	type RemixiconComponentType as LucideIcon,
	RiSparkling2Line as Sparkles,
	RiAlertLine as TriangleAlert,
} from "@remixicon/react";
import {
	type ModelDefault,
	PROJECT_TEMPLATE_PREVIEW_PROTOCOL_VERSION,
	type SlashCommandInfo,
	type TemplateInfo,
	type TemplateReadLocation,
	type ThinkingLevel,
	type WireModel,
} from "@thinkrail/contracts";
import { i18n, T, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@thinkrail/ui/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { Textarea } from "@thinkrail/ui/textarea";
import { cn } from "@thinkrail/ui/utils";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { type DefaultPairOption, ModelEffortPicker } from "@/chat/ModelEffortPicker";
import {
	deriveProjectTrustNotice,
	type ProjectTrustNotice,
	trustEnablesText,
	trustGrantParams,
	untrustedNoticeText,
} from "@/chat/projectTrust";
import {
	imagePasteDropHandlers,
	PROMPT_IMAGE_CHIPS_PADDING,
	PromptImageChips,
	usePromptImages,
} from "@/chat/promptImages";
import { SkillsButton } from "@/chat/SkillsButton";
import { SkillsDialog } from "@/chat/SkillsDialog";
import { useModelCatalog } from "@/chat/useModelCatalog";
import { useModelPreferences } from "@/chat/useModelPreferences";
import { useProjectTrustSummary } from "@/chat/useProjectTrustSummary";
import {
	applyTemplateSlotEdit,
	beginTemplateSlotSession,
	finalizeTemplateSlotSession,
	isPromptKeyEventComposing,
	type ParsedTemplate,
	SlashCommandMenu,
	selectedSlashCommandValue,
	slashCommandCatalogOrEmpty,
	slashCommandQuery,
	stepTemplateSlotSession,
	TemplateSlotHint,
	type TemplateSlotSessionState,
	templateToSlashCommand,
	usePendingSelection,
	useSlashCommandCompletion,
	useTemplateCommandPicker,
} from "@/prompt";
import { selectCatalogModel, selectPickerModels, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { BranchPicker } from "./BranchPicker";
import { useBranchList } from "./branches";
import { prepareStartWorkspace, startChatIn } from "./startWork";

type WorkspaceTarget = "worktree" | "default";

export function reconcileModel(
	models: readonly WireModel[],
	model: WireModel,
	catalogFresh: boolean,
): WireModel | "unavailable" | null {
	const found = selectCatalogModel(models, model);
	if (found) return found;
	return catalogFresh && models.length > 0 ? "unavailable" : null;
}

const PILL =
	"flex h-32 min-w-0 items-center gap-8 rounded-sm border border-control-border-default bg-clip-padding bg-control-bg px-8 tr-text-ui text-text-default outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:border-control-border-active data-[open=true]:bg-control-bg-selected";

export function NewWorkspaceDialog({
	open,
	projectId,
	initialPrompt,
	promptNote,
	onOpenChange,
}: {
	open: boolean;
	projectId: string;
	initialPrompt?: string;
	promptNote?: string;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useT();
	const projects = useAppStore((s) => s.projects);
	const protocolVersion = useAppStore((s) => s.protocolVersion);

	const [selectedProjectId, setSelectedProjectId] = useState(projectId);
	const [target, setTarget] = useState<WorkspaceTarget>("worktree");
	const [baseRef, setBaseRef] = useState<string>("");
	const [prompt, setPrompt] = useState("");
	const [skillCommands, setSkillCommands] = useState<SlashCommandInfo[]>([]);
	const [templates, setTemplates] = useState<TemplateInfo[]>([]);
	const [slotSession, setSlotSession] = useState<TemplateSlotSessionState | null>(null);
	const [model, setModel] = useState<WireModel | null>(null);
	const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");
	const [hostDefault, setHostDefault] = useState<ModelDefault | null>(null);
	const [explicitPair, setExplicitPair] = useState(false);
	const pendingDefault = useRef<(() => void) | null>(null);
	const pickExplicitly = useCallback(() => {
		pendingDefault.current?.();
		pendingDefault.current = null;
		setExplicitPair(true);
	}, []);
	const attachedImages = usePromptImages();
	const [creating, setCreating] = useState(false);
	const [trusting, setTrusting] = useState(false);
	const [manageSkills, setManageSkills] = useState(false);
	const promptRef = useRef<HTMLTextAreaElement>(null);
	const hostDefaultAsked = useRef(false);
	const targetGroupName = useId();
	const [dialogEl, setDialogEl] = useState<HTMLElement | null>(null);
	const updatePromptDraft = useCallback(
		(nextPrompt: string, nextSlotSession: TemplateSlotSessionState | null) => {
			setPrompt(nextPrompt);
			setSlotSession(nextSlotSession);
		},
		[],
	);

	const focusPromptSelection = usePendingSelection(promptRef);

	const supportsProjectTemplatePreview =
		protocolVersion !== null && protocolVersion >= PROJECT_TEMPLATE_PREVIEW_PROTOCOL_VERSION;
	const loadTemplate = useCallback(
		(name: string) => {
			const location: TemplateReadLocation = supportsProjectTemplatePreview
				? { projectId: selectedProjectId }
				: {};
			return getTransport().request("template.get", { ...location, name });
		},
		[selectedProjectId, supportsProjectTemplatePreview],
	);
	const applyTemplate = useCallback(
		(template: ParsedTemplate) => {
			const transition = beginTemplateSlotSession(template);
			updatePromptDraft(transition.value, transition.session);
			focusPromptSelection(transition.selection.start, transition.selection.end);
		},
		[focusPromptSelection, updatePromptDraft],
	);
	const { pending: templatePending, pick: pickTemplate } = useTemplateCommandPicker({
		draft: prompt,
		contextKey: `${selectedProjectId}:${supportsProjectTemplatePreview ? "project" : "global"}`,
		load: loadTemplate,
		onApply: applyTemplate,
	});
	const slashCompletion = useSlashCommandCompletion({
		value: prompt,
		commands: [...skillCommands, ...templates.map(templateToSlashCommand)],
		onSelect: (command) => {
			if (command.source === "prompt") {
				void pickTemplate(command.name);
				return;
			}
			const next = selectedSlashCommandValue(command);
			updatePromptDraft(next, null);
			focusPromptSelection(next.length);
		},
	});
	const slashActive = slashCommandQuery(prompt) !== null;

	const stepPromptSlot = (direction: 1 | -1) => {
		if (!slotSession) return;
		const transition = stepTemplateSlotSession(prompt, slotSession, direction);
		updatePromptDraft(transition.value, transition.session);
		focusPromptSelection(transition.selection.start, transition.selection.end);
	};

	useEffect(() => {
		if (!open) return;
		setSelectedProjectId(projectId);
		updatePromptDraft(initialPrompt ?? "", null);
		setTarget("worktree");
		setCreating(false);
		attachedImages.reset();
		hostDefaultAsked.current = false;
		setExplicitPair(false);
	}, [open, projectId, initialPrompt, updatePromptDraft, attachedImages.reset]);

	useEffect(() => {
		if (!open) return;
		if (projects.some((p) => p.id === selectedProjectId)) return;
		onOpenChange(false);
		toast.info(i18n.t("panels.newWorkspace.projectClosed"));
	}, [open, projects, selectedProjectId, onOpenChange]);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setSkillCommands([]);
		setTemplates([]);
		void slashCommandCatalogOrEmpty(() =>
			getTransport().request("skill.list", { projectId: selectedProjectId }),
		).then((commands) => {
			if (!cancelled) setSkillCommands(commands);
		});
		return () => {
			cancelled = true;
		};
	}, [open, selectedProjectId]);

	useEffect(() => {
		if (!open || !slashActive) return;
		let cancelled = false;
		const location: TemplateReadLocation = supportsProjectTemplatePreview
			? { projectId: selectedProjectId }
			: {};
		getTransport()
			.request("template.list", location)
			.then(({ templates: nextTemplates }) => {
				if (!cancelled) setTemplates(nextTemplates);
			})
			.catch(() => {
				if (!cancelled) setTemplates([]);
			});
		return () => {
			cancelled = true;
		};
	}, [open, selectedProjectId, slashActive, supportsProjectTemplatePreview]);

	const trustSummary = useProjectTrustSummary(selectedProjectId, open);

	const {
		models: allModels,
		refreshing: modelsRefreshing,
		refresh: onRefreshModels,
		fresh: catalogFresh,
	} = useModelCatalog(open);
	const hiddenModels = useAppStore((s) => s.hiddenModels);
	const visibleModels = useMemo(
		() => selectPickerModels(allModels, hiddenModels, []),
		[allModels, hiddenModels],
	);
	const models = useMemo(
		() => selectPickerModels(allModels, hiddenModels, [model]),
		[allModels, hiddenModels, model],
	);
	const modelPreferences = useModelPreferences(visibleModels);

	const applyHostDefault = useCallback(() => {
		let cancelled = false;
		const cancel = () => {
			cancelled = true;
		};
		pendingDefault.current?.();
		pendingDefault.current = cancel;
		setExplicitPair(false);
		getTransport()
			.request("model.default", {})
			.then((d) => {
				setHostDefault(d);
				if (cancelled) return;
				pendingDefault.current = null;
				setModel(d.model);
				setThinkingLevel(d.thinkingLevel);
			})
			.catch(() => {});
		return cancel;
	}, []);

	const defaultOption: DefaultPairOption = {
		resolved: hostDefault,
		active: !explicitPair,
		onSelect: () => {
			applyHostDefault();
		},
	};

	useEffect(() => {
		if (!open) return;
		return applyHostDefault();
	}, [open, applyHostDefault]);

	useEffect(() => {
		if (!open || !model) return;
		const next = reconcileModel(allModels, model, catalogFresh);
		if (next === null) return;
		if (next !== "unavailable") {
			if (next !== model) setModel(next);
			return;
		}
		if (hostDefaultAsked.current) return;
		hostDefaultAsked.current = true;
		return applyHostDefault();
	}, [open, allModels, model, catalogFresh, applyHostDefault]);

	useEffect(() => {
		if (!open || !model) return;
		if (model.thinkingLevels.includes(thinkingLevel)) return;
		let cancelled = false;
		getTransport()
			.request("model.clampThinking", {
				provider: model.provider,
				id: model.id,
				level: thinkingLevel,
			})
			.then((r) => {
				if (!cancelled) setThinkingLevel(r.level);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [open, model, thinkingLevel]);

	const prefetchBase = (ref: string) => {
		if (!ref) return;
		getTransport()
			.request("git.prefetch", { projectId: selectedProjectId, ref })
			.catch(() => {});
	};

	const selectBaseRef = (ref: string) => {
		setBaseRef(ref);
		if (branches?.remote.includes(ref)) prefetchBase(ref);
	};

	const {
		branches,
		refreshing,
		refresh: refreshBranches,
	} = useBranchList(open ? selectedProjectId : null, (list) => {
		setBaseRef(list.defaultBranch);
		prefetchBase(list.defaultBranch);
	});
	const submitEnabled = !creating && !templatePending && attachedImages.pending === 0;

	const create = async () => {
		if (!submitEnabled) return;
		setCreating(true);
		const text = finalizeTemplateSlotSession(prompt, slotSession).trim();
		const attachments = attachedImages.images.map(({ name, content }) => ({ name, content }));
		const workspace = await prepareStartWorkspace(
			target === "default"
				? { kind: "project-folder", projectId: selectedProjectId }
				: { kind: "workspace", projectId: selectedProjectId, baseRef },
		);
		if (!workspace) {
			setCreating(false);
			return;
		}
		onOpenChange(false);
		await startChatIn(workspace, {
			text,
			images: attachments,
			...(model && explicitPair ? { model: { model, thinkingLevel } } : {}),
		});
	};

	const trustProject = async (notice: Extract<ProjectTrustNotice, { kind: "untrusted" }>) => {
		if (trusting) return;
		setTrusting(true);
		try {
			const updated = await getTransport().request(
				"project.setTrust",
				trustGrantParams(selectedProjectId, notice),
			);
			useAppStore.getState().applyProjectUpdated(updated);
			const commands = await slashCommandCatalogOrEmpty(() =>
				getTransport().request("skill.list", { projectId: selectedProjectId }),
			);
			setSkillCommands(commands);
		} catch (err) {
			toast.error(errorText(err), t("panels.newWorkspace.trustFailed"));
		} finally {
			setTrusting(false);
		}
	};

	const selectedProject = projects.find((p) => p.id === selectedProjectId);
	const trustNotice = deriveProjectTrustNotice(selectedProject, trustSummary);
	const trustEnables = trustNotice.kind === "untrusted" ? trustEnablesText(t, trustNotice) : null;
	const isolated = target === "worktree";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				ref={setDialogEl}
				hideClose
				data-testid="new-workspace-dialog"
				className="max-w-[600px] gap-12 p-12"
				onEscapeKeyDown={(event) => {
					if (slashCompletion.open) {
						event.preventDefault();
						slashCompletion.dismiss();
						return;
					}
					if (!slotSession) return;
					event.preventDefault();
					updatePromptDraft(prompt, null);
				}}
				onOpenAutoFocus={(e) => {
					e.preventDefault();
					promptRef.current?.focus();
				}}
			>
				<DialogHeader>
					<DialogTitle>
						{isolated
							? t("panels.newWorkspace.titleIsolated")
							: t("panels.newWorkspace.titleDefault")}
					</DialogTitle>
					<DialogDescription>
						{isolated
							? t("panels.newWorkspace.descriptionIsolated")
							: t("panels.newWorkspace.descriptionDefault")}
					</DialogDescription>
				</DialogHeader>

				<fieldset
					data-testid="ws-target"
					className="flex w-fit items-center gap-2 rounded-md border border-control-border-default bg-control-bg p-2"
				>
					<legend className="sr-only">{t("panels.newWorkspace.targetLegend")}</legend>
					<TargetOption
						icon={GitBranch}
						label={t("panels.newWorkspace.targetIsolated")}
						name={targetGroupName}
						active={isolated}
						testid="ws-target-worktree"
						onSelect={() => setTarget("worktree")}
					/>
					<TargetOption
						icon={House}
						label={t("panels.newWorkspace.targetDefault")}
						name={targetGroupName}
						active={!isolated}
						testid="ws-target-default"
						onSelect={() => setTarget("default")}
					/>
				</fieldset>

				<div className="flex flex-wrap items-center gap-8">
					<ProjectPicker
						projects={projects}
						current={selectedProject?.name ?? t("panels.newWorkspace.projectFallback")}
						container={dialogEl}
						onSelect={setSelectedProjectId}
					/>
					{isolated ? (
						<BranchPicker
							branches={branches}
							selected={baseRef}
							label={t("panels.newWorkspace.baseLabel")}
							testid="ws-branch-picker"
							triggerClassName={`${PILL} max-w-[220px]`}
							refreshing={refreshing}
							container={dialogEl}
							onSelect={selectBaseRef}
							onRefresh={refreshBranches}
						/>
					) : null}
					<SkillsButton
						onOpen={() => setManageSkills(true)}
						testId="ws-manage-skills"
						className="ml-auto"
					/>
				</div>

				{trustNotice.kind === "untrusted" ? (
					<div
						data-testid="ws-trust-notice"
						className="flex w-full flex-col gap-8 rounded-sm border border-feedback-warning-muted bg-container-elevated-bg px-12 py-8 text-left"
					>
						<div className="flex items-start gap-8">
							<TriangleAlert className="mt-2 size-14 shrink-0 text-feedback-warning" aria-hidden />
							<span className="flex min-w-0 flex-1 flex-col gap-2">
								<span className="tr-text-ui text-text-default">
									{untrustedNoticeText(t, trustNotice)} {t("panels.newWorkspace.trustUnaffected")}
								</span>
								{trustEnables ? (
									<span className="text-text-muted tr-text-metadata">{trustEnables}</span>
								) : null}
							</span>
						</div>
						<div className="flex justify-end">
							<Button
								variant="outline"
								size="sm"
								data-testid="ws-trust-project"
								disabled={trusting}
								onClick={() => void trustProject(trustNotice)}
							>
								{t("panels.newWorkspace.trustProject")}
							</Button>
						</div>
					</div>
				) : null}

				<div className="relative">
					{promptNote ? (
						<p
							data-testid="ws-prompt-note"
							className="mb-4 flex items-start gap-8 rounded-sm border border-primary-muted bg-clip-padding bg-primary-subtle px-12 py-8 text-left text-text-muted tr-text-metadata leading-snug"
						>
							<Sparkles className="mt-2 size-14 shrink-0 text-primary" />
							<span>{promptNote}</span>
						</p>
					) : null}
					<PromptImageChips
						controller={attachedImages}
						testId="ws-prompt-images"
						className={PROMPT_IMAGE_CHIPS_PADDING.dialog}
					/>
					<Textarea
						ref={promptRef}
						data-testid="ws-prompt"
						value={prompt}
						disabled={creating}
						{...imagePasteDropHandlers(attachedImages)}
						onChange={(e) => {
							const next = e.target.value;
							const nextSlotSession = slotSession
								? applyTemplateSlotEdit(prompt, next, e.target.selectionStart, slotSession)
								: null;
							updatePromptDraft(next, nextSlotSession);
						}}
						placeholder={t("panels.newWorkspace.promptPlaceholder")}
						spellCheck={false}
						rows={6}
						className="min-h-[160px]"
						onKeyDown={(e) => {
							if (isPromptKeyEventComposing(e.nativeEvent)) return;
							if (slotSession && !slashCompletion.open) {
								if (e.key === "Tab") {
									e.preventDefault();
									e.stopPropagation();
									stepPromptSlot(e.shiftKey ? -1 : 1);
									return;
								}
								if (e.key === "Escape") {
									e.preventDefault();
									e.stopPropagation();
									updatePromptDraft(prompt, null);
									return;
								}
							}
							if (slashCompletion.handleKeyDown(e)) return;
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								if (submitEnabled) void create();
							}
						}}
					/>
					{slashCompletion.open ? (
						<SlashCommandMenu
							commands={slashCompletion.matches}
							activeIndex={slashCompletion.activeIndex}
							onSelect={slashCompletion.pick}
							className="absolute top-full left-8 z-50 mt-4"
						/>
					) : slotSession ? (
						<TemplateSlotHint
							activeIndex={slotSession.activeIndex}
							count={slotSession.slots.length}
							onNext={() => stepPromptSlot(1)}
							className="absolute top-full left-8 z-50 mt-4"
						/>
					) : prompt.trim() && isolated ? (
						<p
							data-testid="workspace-naming-hint"
							className="px-4 text-text-muted tr-text-metadata"
						>
							{t("panels.newWorkspace.namingHint")}
						</p>
					) : (
						<p className="mt-4 text-text-muted tr-text-metadata">
							<T
								i18nKey="panels.newWorkspace.slashHint"
								components={[<span key="slash" className="tr-code-text" />]}
							/>
						</p>
					)}
				</div>

				<div className="flex flex-wrap items-center gap-8">
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-8">
						<ModelEffortPicker
							models={models}
							current={model}
							level={thinkingLevel}
							refreshing={modelsRefreshing}
							onRefresh={onRefreshModels}
							onSelect={({ model: next, level }) => {
								pickExplicitly();
								setModel(next);
								if (level) setThinkingLevel(level);
							}}
							onSelectLevel={(level) => {
								pickExplicitly();
								setThinkingLevel(level);
							}}
							preferences={modelPreferences}
							defaultOption={defaultOption}
							container={dialogEl}
							className="max-w-full"
						/>
					</div>
					<button
						type="button"
						data-testid="create-workspace"
						disabled={!submitEnabled}
						onClick={() => void create()}
						className="flex h-32 shrink-0 items-center gap-8 rounded-sm bg-control-primary-bg px-12 tr-text-action text-control-primary-text outline-none transition-colors hover:bg-control-primary-bg-hovered focus-visible:ring-2 focus-visible:ring-primary disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text"
					>
						{creating ? (
							<>
								<Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
								{isolated ? t("panels.newWorkspace.creating") : t("panels.newWorkspace.starting")}
							</>
						) : (
							<>
								{isolated ? t("panels.newWorkspace.create") : t("panels.newWorkspace.start")}
								<span className="inline-flex h-16 min-w-16 items-center justify-center rounded-sm bg-on-primary-soft px-4 tr-code-text">
									↵
								</span>
							</>
						)}
					</button>
				</div>
				<SkillsDialog
					projectId={selectedProjectId}
					open={manageSkills}
					onOpenChange={setManageSkills}
				/>
			</DialogContent>
		</Dialog>
	);
}

function TargetOption({
	icon: Icon,
	label,
	name,
	active,
	testid,
	onSelect,
}: {
	icon: LucideIcon;
	label: string;
	name: string;
	active: boolean;
	testid: string;
	onSelect: () => void;
}) {
	return (
		<label
			data-testid={testid}
			data-active={active}
			className={cn(
				"flex h-28 cursor-pointer items-center gap-8 rounded-sm px-12 tr-text-ui transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
				active ? "bg-primary-subtle text-primary" : "text-text-muted hover:text-text-default",
			)}
		>
			<input type="radio" name={name} className="sr-only" checked={active} onChange={onSelect} />
			<Icon className="size-14 shrink-0" />
			{label}
		</label>
	);
}

function ProjectPicker({
	projects,
	current,
	container,
	onSelect,
}: {
	projects: { id: string; name: string }[];
	current: string;
	container: HTMLElement | null;
	onSelect: (projectId: string) => void;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				data-testid="ws-project-picker"
				data-open={open}
				className={`${PILL} max-w-[180px]`}
			>
				<span className="flex size-[18px] shrink-0 items-center justify-center rounded-sm bg-primary">
					<Box className="size-12 text-text-on-primary" />
				</span>
				<span className="truncate">{current}</span>
				<ChevronDown className="size-16 shrink-0 text-text-muted" />
			</PopoverTrigger>
			<PopoverContent align="start" container={container} className="w-[280px] p-0">
				<Command>
					<CommandInput placeholder={t("panels.newWorkspace.searchProjects")} />
					<CommandList>
						<CommandEmpty>{t("panels.newWorkspace.noProjects")}</CommandEmpty>
						<CommandGroup>
							{projects.map((p) => (
								<CommandItem
									key={p.id}
									value={p.name}
									data-testid="ws-project-option"
									onSelect={() => {
										onSelect(p.id);
										setOpen(false);
									}}
								>
									<Box className="size-14 shrink-0 text-text-muted" />
									<span className="truncate">{p.name}</span>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
