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
import type { SlashCommandInfo, ThinkingLevel, WireModel, Workspace } from "@thinkrail/contracts";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ModelSelector } from "@/chat/ModelSelector";
import { SkillsButton } from "@/chat/SkillsButton";
import { SkillsDialog } from "@/chat/SkillsDialog";
import {
	SlashCommandMenu,
	selectedSlashCommandValue,
	slashCommandCatalogOrEmpty,
	useSlashCommandCompletion,
} from "@/chat/SlashCommandCompletion";
import { ThinkingSelector } from "@/chat/ThinkingSelector";
import { useModelCatalog } from "@/chat/useModelCatalog";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { selectCatalogModel, toast, useAppStore } from "@/store";
import { createSessionWithSkillBaseline, errorText, getTransport } from "@/transport";
import { BranchPicker } from "./BranchPicker";
import { useBranchList } from "./branches";
import { enterDefaultWorkspace } from "./defaultWorkspace";

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
	"flex h-32 min-w-0 items-center gap-8 rounded-[var(--radius-sm)] border border-control-border-default bg-clip-padding bg-control-bg px-8 tr-text-ui text-text-default outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:border-control-border-active data-[open=true]:bg-control-bg-selected";

export function NewWorkspaceDialog({
	open,
	projectId,
	initialPrompt,
	promptNote,
	onOpenChange,
	onCreated,
}: {
	open: boolean;
	projectId: string;
	initialPrompt?: string;
	promptNote?: string;
	onOpenChange: (open: boolean) => void;
	onCreated: (workspace: Workspace) => void;
}) {
	const projects = useAppStore((s) => s.projects);

	const [selectedProjectId, setSelectedProjectId] = useState(projectId);
	const [target, setTarget] = useState<WorkspaceTarget>("worktree");
	const [baseRef, setBaseRef] = useState<string>("");
	const [prompt, setPrompt] = useState("");
	const [skillCommands, setSkillCommands] = useState<SlashCommandInfo[]>([]);
	const [aliasSkills, setAliasSkills] = useState<string[]>([]);
	const [model, setModel] = useState<WireModel | null>(null);
	const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");
	const [creating, setCreating] = useState(false);
	const [trusting, setTrusting] = useState(false);
	const [manageSkills, setManageSkills] = useState(false);
	const promptRef = useRef<HTMLTextAreaElement>(null);
	const hostDefaultAsked = useRef(false);
	const targetGroupName = useId();
	const [dialogEl, setDialogEl] = useState<HTMLElement | null>(null);

	const focusPromptCaret = (position: number) => {
		requestAnimationFrame(() => {
			const input = promptRef.current;
			if (!input) return;
			input.focus();
			input.setSelectionRange(position, position);
		});
	};

	const slashCompletion = useSlashCommandCompletion({
		value: prompt,
		commands: skillCommands,
		onSelect: (command) => {
			const next = selectedSlashCommandValue(command);
			setPrompt(next);
			focusPromptCaret(next.length);
		},
	});

	useEffect(() => {
		if (!open) return;
		setSelectedProjectId(projectId);
		setPrompt(initialPrompt ?? "");
		setTarget("worktree");
		setCreating(false);
		hostDefaultAsked.current = false;
	}, [open, projectId, initialPrompt]);

	useEffect(() => {
		if (!open) return;
		if (projects.some((p) => p.id === selectedProjectId)) return;
		onOpenChange(false);
		toast.info("That project was closed");
	}, [open, projects, selectedProjectId, onOpenChange]);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setSkillCommands([]);
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
		if (!open) return;
		let cancelled = false;
		setAliasSkills([]);
		getTransport()
			.request("project.aliasSkills", { projectId: selectedProjectId })
			.then((names) => {
				if (!cancelled) setAliasSkills(names);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [open, selectedProjectId]);

	const {
		models,
		refreshing: modelsRefreshing,
		refresh: onRefreshModels,
		fresh: catalogFresh,
	} = useModelCatalog(open);

	const applyHostDefault = useCallback(() => {
		let cancelled = false;
		getTransport()
			.request("model.default", {})
			.then((d) => {
				if (cancelled) return;
				setModel(d.model);
				setThinkingLevel(d.thinkingLevel);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!open) return;
		return applyHostDefault();
	}, [open, applyHostDefault]);

	useEffect(() => {
		if (!open || !model) return;
		const next = reconcileModel(models, model, catalogFresh);
		if (next === null) return;
		if (next !== "unavailable") {
			if (next !== model) setModel(next);
			return;
		}
		if (hostDefaultAsked.current) return;
		hostDefaultAsked.current = true;
		return applyHostDefault();
	}, [open, models, model, catalogFresh, applyHostDefault]);

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
		if (!ref.startsWith("origin/")) return;
		getTransport()
			.request("git.prefetch", { projectId: selectedProjectId, ref })
			.catch(() => {});
	};

	const selectBaseRef = (ref: string) => {
		setBaseRef(ref);
		prefetchBase(ref);
	};

	const {
		branches,
		refreshing,
		refresh: refreshBranches,
	} = useBranchList(open ? selectedProjectId : null, (list) => {
		setBaseRef(list.defaultBranch);
		prefetchBase(list.defaultBranch);
	});

	const create = async () => {
		if (creating) return;
		setCreating(true);
		let workspace: Workspace;
		if (target === "default") {
			const def = await enterDefaultWorkspace(selectedProjectId);
			if (!def) {
				setCreating(false);
				return;
			}
			workspace = def;
		} else {
			try {
				workspace = await getTransport().request("workspace.create", {
					projectId: selectedProjectId,
					...(baseRef ? { baseRef } : {}),
				});
			} catch (err) {
				toast.error(errorText(err), "Couldn't create workspace");
				setCreating(false);
				return;
			}
		}

		const store = useAppStore.getState();
		if (target === "worktree") {
			onCreated(workspace);
			store.activateWorkspace(workspace);
		}
		onOpenChange(false);

		const text = prompt.trim();
		store.beginChatStart(workspace.id);
		try {
			const { result: session, syncedTick } = await createSessionWithSkillBaseline({
				workspaceId: workspace.id,
				...(model ? { model } : {}),
				thinkingLevel,
			});
			store.openChatSession(
				workspace.id,
				session.sessionId,
				session.model,
				session.thinkingLevel,
				syncedTick,
			);
			if (!text) return;
			store.appendUserMessage(session.sessionId, text);
			getTransport()
				.request("session.prompt", { sessionId: session.sessionId, text })
				.catch((err) => store.appendErrorTurn(session.sessionId, errorText(err)));
		} catch (err) {
			toast.error(errorText(err), "Couldn't start the chat");
		} finally {
			useAppStore.getState().endChatStart(workspace.id);
		}
	};

	const trustProject = async () => {
		if (trusting) return;
		setTrusting(true);
		try {
			const updated = await getTransport().request("project.setTrust", {
				id: selectedProjectId,
				trusted: true,
			});
			useAppStore.getState().applyProjectUpdated(updated);
			const commands = await slashCommandCatalogOrEmpty(() =>
				getTransport().request("skill.list", { projectId: selectedProjectId }),
			);
			setSkillCommands(commands);
		} catch (err) {
			toast.error(errorText(err), "Couldn't trust project");
		} finally {
			setTrusting(false);
		}
	};

	const selectedProject = projects.find((p) => p.id === selectedProjectId);
	const isolated = target === "worktree";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				ref={setDialogEl}
				hideClose
				data-testid="new-workspace-dialog"
				className="max-w-[600px] gap-12 p-12"
				onEscapeKeyDown={(event) => {
					if (!slashCompletion.open) return;
					event.preventDefault();
					slashCompletion.dismiss();
				}}
				onOpenAutoFocus={(e) => {
					e.preventDefault();
					promptRef.current?.focus();
				}}
			>
				<DialogHeader>
					<DialogTitle>{isolated ? "Create workspace" : "Work in project folder"}</DialogTitle>
					<DialogDescription>
						{isolated
							? "A separate checkout on its own new branch. Files, chats, changes, and terminals stay scoped to it."
							: "Runs directly in your project folder — no isolation. Changes land on the current branch."}
					</DialogDescription>
				</DialogHeader>

				<fieldset
					data-testid="ws-target"
					className="flex w-fit items-center gap-2 rounded-[var(--radius-md)] border border-control-border-default bg-control-bg p-2"
				>
					<legend className="sr-only">Where the work runs</legend>
					<TargetOption
						icon={GitBranch}
						label="Isolated workspace"
						name={targetGroupName}
						active={isolated}
						testid="ws-target-worktree"
						onSelect={() => setTarget("worktree")}
					/>
					<TargetOption
						icon={House}
						label="Project folder"
						name={targetGroupName}
						active={!isolated}
						testid="ws-target-default"
						onSelect={() => setTarget("default")}
					/>
				</fieldset>

				<div className="flex flex-wrap items-center gap-8">
					<ProjectPicker
						projects={projects}
						current={selectedProject?.name ?? "Project"}
						container={dialogEl}
						onSelect={setSelectedProjectId}
					/>
					{isolated ? (
						<BranchPicker
							branches={branches}
							selected={baseRef}
							label="From"
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

				{selectedProject && selectedProject.trusted !== true && aliasSkills.length > 0 ? (
					<div
						data-testid="ws-trust-notice"
						className="flex w-full items-center gap-8 rounded-[var(--radius-sm)] border border-border-default border-l-[3px] border-l-feedback-warning bg-feedback-warning-subtle px-12 py-8 text-left"
					>
						<TriangleAlert className="size-16 shrink-0 text-feedback-warning" />
						<span className="min-w-0 flex-1 tr-text-ui text-text-default">
							This project ships {aliasSkills.length} skill{aliasSkills.length === 1 ? "" : "s"} —
							off until you trust it. Your personal and ThinkRail's built-in skills are unaffected.
						</span>
						<Button
							size="sm"
							data-testid="ws-trust-project"
							disabled={trusting}
							onClick={() => void trustProject()}
							className="shrink-0"
						>
							Trust project
						</Button>
					</div>
				) : null}

				<div className="relative">
					{promptNote ? (
						<p
							data-testid="ws-prompt-note"
							className="mb-4 flex items-start gap-8 rounded-[var(--radius-sm)] border border-primary-muted bg-clip-padding bg-primary-subtle px-12 py-8 text-left text-text-muted tr-text-metadata leading-snug"
						>
							<Sparkles className="mt-2 size-14 shrink-0 text-primary" />
							<span>{promptNote}</span>
						</p>
					) : null}
					<Textarea
						ref={promptRef}
						data-testid="ws-prompt"
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						placeholder="What do you want to work on?"
						spellCheck={false}
						rows={6}
						className="min-h-[160px]"
						onKeyDown={(e) => {
							if (slashCompletion.handleKeyDown(e)) return;
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								void create();
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
					) : prompt.trim() && isolated ? (
						<p
							data-testid="workspace-naming-hint"
							className="px-4 text-text-muted tr-text-metadata"
						>
							ThinkRail will name the workspace and branch from your request.
						</p>
					) : (
						<p className="mt-4 text-text-muted tr-text-metadata">
							Type <span className="tr-code-text">/</span> for a project skill — previewed from the
							current checkout; the created workspace's session is authoritative.
						</p>
					)}
				</div>

				<div className="flex flex-wrap items-center gap-8">
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-8">
						<ModelSelector
							models={models}
							current={model}
							refreshing={modelsRefreshing}
							onRefresh={onRefreshModels}
							container={dialogEl}
							onSelect={(m) => {
								setModel(m);
							}}
						/>
						<ThinkingSelector
							level={thinkingLevel}
							levels={model?.thinkingLevels ?? []}
							container={dialogEl}
							onSelect={setThinkingLevel}
						/>
					</div>
					<button
						type="button"
						data-testid="create-workspace"
						disabled={creating}
						onClick={() => void create()}
						className="flex h-32 shrink-0 items-center gap-8 rounded-[var(--radius-sm)] bg-control-primary-bg px-12 tr-text-action text-control-primary-text outline-none transition-colors hover:bg-control-primary-bg-hovered focus-visible:ring-2 focus-visible:ring-primary disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text"
					>
						{creating ? (
							<>
								<Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
								{isolated ? "Creating…" : "Starting…"}
							</>
						) : (
							<>
								{isolated ? "Create" : "Start"}
								<span className="inline-flex h-16 min-w-16 items-center justify-center rounded-[var(--radius-sm)] bg-on-primary-soft px-4 tr-code-text">
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
				"flex h-28 cursor-pointer items-center gap-8 rounded-[var(--radius-sm)] px-12 tr-text-ui transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
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
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				data-testid="ws-project-picker"
				data-open={open}
				className={`${PILL} max-w-[180px]`}
			>
				<span className="flex size-[18px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-primary">
					<Box className="size-12 text-text-on-primary" />
				</span>
				<span className="truncate">{current}</span>
				<ChevronDown className="size-16 shrink-0 text-text-muted" />
			</PopoverTrigger>
			<PopoverContent align="start" container={container} className="w-[280px] p-0">
				<Command>
					<CommandInput placeholder="Search projects…" />
					<CommandList>
						<CommandEmpty>No projects.</CommandEmpty>
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
