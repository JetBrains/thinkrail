import type {
	BranchList,
	CombineMode,
	ThinkingLevel,
	WireModel,
	Workspace,
} from "@thinkrail/contracts";
import { Box, Check, ChevronDown, ChevronRight, GitBranch, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ModelSelector } from "@/chat/ModelSelector";
import { ThinkingSelector } from "@/chat/ThinkingSelector";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { getProjectHooks } from "./hooksActions";

/** A shared pill-trigger look for the project + branch pickers (mockup `.pill`). */
const PILL =
	"flex h-8 min-w-0 items-center gap-sm rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-sm text-sm text-text outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:border-[var(--primary-60)] data-[open=true]:bg-hover";

/** The per-workspace hook-combine-mode choices offered by `HookModeDisclosure` below — same three
 * options/labels as `ProjectHooksDialog`'s project-level combine-mode control. */
const HOOK_MODES: { value: CombineMode; label: string }[] = [
	{ value: "both", label: "Both" },
	{ value: "shared", label: "Shared only" },
	{ value: "local", label: "Local only" },
];

/**
 * The New-Workspace "create + kick-off" surface: pick a base branch, say what to work on, pick a
 * model + effort, then Create → cut a worktree from that base, open a chat in it, and send the prompt.
 * With an empty prompt it just creates the workspace (no chat) — the fast path for poking at files.
 *
 * The only app-integration piece here: it wires the store + transport. `onCreated(ws)` lets the parent
 * (ProjectTree) expand + reload its list; the dialog itself sets the active workspace + kicks off the chat.
 */
export function NewWorkspaceDialog({
	open,
	projectId,
	initialPrompt,
	onOpenChange,
	onCreated,
}: {
	open: boolean;
	/** The project the "+" was clicked on — the picker's default (changeable). */
	projectId: string;
	/** Optional seed for the prompt hero (still fully editable) — e.g. Welcome's "Set up project". */
	initialPrompt?: string;
	onOpenChange: (open: boolean) => void;
	onCreated: (workspace: Workspace) => void;
}) {
	const projects = useAppStore((s) => s.projects);
	const models = useAppStore((s) => s.models);

	const [selectedProjectId, setSelectedProjectId] = useState(projectId);
	const [branches, setBranches] = useState<BranchList | null>(null);
	const [baseRef, setBaseRef] = useState<string>("");
	const [refreshing, setRefreshing] = useState(false);
	const [prompt, setPrompt] = useState("");
	const [model, setModel] = useState<WireModel | null>(null);
	const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");
	const [creating, setCreating] = useState(false);
	const promptRef = useRef<HTMLTextAreaElement>(null);
	// The dialog content node — popovers portal into it so their lists stay scrollable under the Dialog's
	// scroll lock (react-remove-scroll blocks wheel/trackpad on body-portaled content).
	const [dialogEl, setDialogEl] = useState<HTMLElement | null>(null);
	// The Advanced disclosure's hook-combine state. `hookCombineMode` is the user's EXPLICIT per-workspace
	// choice: `null` = untouched (or not loaded / fetch failed) → create() omits it, so the workspace
	// dynamically inherits the project's live committed default at every hook run (see Workspace.hookCombineMode).
	// `projectDefaultMode` is only the value shown in the selector until the user picks. `hasProjectHooks`
	// gates whether the disclosure renders at all (hookless projects show nothing extra).
	const [hookCombineMode, setHookCombineMode] = useState<CombineMode | null>(null);
	const [projectDefaultMode, setProjectDefaultMode] = useState<CombineMode>("both");
	const [hasProjectHooks, setHasProjectHooks] = useState(false);
	const [advancedOpen, setAdvancedOpen] = useState(false);

	// Reset the form each time the dialog opens, anchored to the project the "+" was clicked on and any
	// seed prompt (empty by default).
	useEffect(() => {
		if (!open) return;
		setSelectedProjectId(projectId);
		setPrompt(initialPrompt ?? "");
		setCreating(false);
	}, [open, projectId, initialPrompt]);

	// Models are global to the host — fetch once into the shared store; the picker reads them.
	useEffect(() => {
		if (!open || models.length > 0) return;
		getTransport()
			.request("model.list", {})
			.then((m) => useAppStore.getState().setModels(m))
			.catch(() => {});
	}, [open, models.length]);

	// Preselect the exact model + effort a fresh session would resolve to (so the picker shows the real
	// model, not a placeholder). Passing it back at create time is a no-op vs. the host default.
	useEffect(() => {
		if (!open) return;
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
	}, [open]);

	// Warm a remote base ref in the background so `workspace.create` branches off a fresh tip without
	// paying the ~2s `git fetch` on the create path. Fire-and-forget: it overlaps branch-picking / typing,
	// and offline / local refs are a no-op host-side. Called on open (default base) + on a remote pick.
	const prefetchBase = (ref: string) => {
		if (!ref.startsWith("origin/")) return;
		getTransport()
			.request("git.prefetch", { projectId: selectedProjectId, ref })
			.catch(() => {});
	};

	// Base picked in the combobox: set it and warm it (if remote) so create stays instant.
	const selectBaseRef = (ref: string) => {
		setBaseRef(ref);
		prefetchBase(ref);
	};

	// Branches for the selected project; preselect the default base. Refetched when the project changes.
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setBranches(null);
		getTransport()
			.request("git.listBranches", { projectId: selectedProjectId })
			.then((list) => {
				if (cancelled) return;
				setBranches(list);
				setBaseRef(list.defaultBranch);
				// Warm the preselected base now, while the user reads/types — create then skips the fetch.
				// Inlined (not via prefetchBase) so the effect's deps stay [open, selectedProjectId].
				if (list.defaultBranch.startsWith("origin/")) {
					getTransport()
						.request("git.prefetch", { projectId: selectedProjectId, ref: list.defaultBranch })
						.catch(() => {});
				}
			})
			.catch(() => {
				if (!cancelled) setBranches({ local: [], remote: [], defaultBranch: "HEAD" });
			});
		return () => {
			cancelled = true;
		};
	}, [open, selectedProjectId]);

	// The project's declared hooks, refetched per selected project (like the branch list above) so
	// switching projects in the picker keeps the Advanced selector's default/visibility in sync. Reset up
	// front so a project switch can't show the previous project's stale mode/visibility while the new fetch
	// is in flight.
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setHookCombineMode(null);
		setProjectDefaultMode("both");
		setHasProjectHooks(false);
		setAdvancedOpen(false);
		getProjectHooks(selectedProjectId)
			.then((hooks) => {
				if (cancelled) return;
				setProjectDefaultMode(hooks.combineMode);
				setHasProjectHooks(
					Object.keys(hooks.shared).length > 0 || Object.keys(hooks.local).length > 0,
				);
			})
			.catch(() => {
				// Leave hasProjectHooks false (selector hidden) and hookCombineMode null (create omits it) —
				// the same safe fallback a genuinely hookless project gets.
			});
		return () => {
			cancelled = true;
		};
	}, [open, selectedProjectId]);

	const refreshBranches = async () => {
		setRefreshing(true);
		try {
			const list = await getTransport().request("git.listBranches", {
				projectId: selectedProjectId,
			});
			setBranches(list);
		} catch {
			// Keep the current list on failure.
		} finally {
			setRefreshing(false);
		}
	};

	const create = async () => {
		if (creating) return;
		setCreating(true);
		let workspace: Workspace;
		try {
			workspace = await getTransport().request("workspace.create", {
				projectId: selectedProjectId,
				...(baseRef ? { baseRef } : {}),
				...(hookCombineMode ? { hookCombineMode } : {}),
			});
		} catch (err) {
			// Worktree creation failed (bad ref, etc.) — keep the dialog open so the user can retry/adjust,
			// and surface the reason (it's otherwise invisible — the dialog just refuses to close).
			toast.error(errorText(err), "Couldn't create workspace");
			setCreating(false);
			return;
		}

		// The worktree exists — the "new workspace" intent is fulfilled, so close the dialog *now* and run the
		// (slower, optional) chat kick-off in the background. This keeps the dialog from lingering while pi
		// spins up a session, and a kick-off failure can't strand the dialog open.
		const store = useAppStore.getState();
		onCreated(workspace);
		store.setActiveWorkspace(workspace.id);
		onOpenChange(false);

		const text = prompt.trim();
		if (!text) return;
		try {
			const session = await getTransport().request("session.create", {
				workspaceId: workspace.id,
				...(model ? { model } : {}),
				thinkingLevel,
			});
			store.openChatSession(workspace.id, session.sessionId, session.model, session.thinkingLevel);
			store.appendUserMessage(session.sessionId, text);
			// Fire-and-forget the turn (it resolves only when the turn ends); the now-open chat tab streams it.
			// A rejected send (bad model / no API key) surfaces as an error turn in the just-opened chat rather
			// than vanishing — the "pick a bad model → nothing happens" failure. Streaming faults arrive as events.
			getTransport()
				.request("session.prompt", { sessionId: session.sessionId, text })
				.catch((err) => store.appendErrorTurn(session.sessionId, errorText(err)));
		} catch (err) {
			// `session.create` itself failed — there's no session/tab to host an error turn, and the dialog has
			// already closed (the workspace exists), so a toast is the only place left to surface the kick-off
			// failure. Without it the "create + kick off a chat" intent just silently drops the chat.
			toast.error(errorText(err), "Couldn't start the chat");
		}
	};

	const selectedProject = projects.find((p) => p.id === selectedProjectId);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				ref={setDialogEl}
				hideClose
				data-testid="new-workspace-dialog"
				className="max-w-[600px] gap-md p-md"
				onOpenAutoFocus={(e) => {
					// Land focus on the prompt (the hero), not the first picker Radix would otherwise focus.
					e.preventDefault();
					promptRef.current?.focus();
				}}
			>
				<DialogTitle className="sr-only">New workspace</DialogTitle>

				{/* controls-top: project + base-branch pickers */}
				<div className="flex flex-wrap items-center gap-sm">
					<ProjectPicker
						projects={projects}
						current={selectedProject?.name ?? "Project"}
						container={dialogEl}
						onSelect={setSelectedProjectId}
					/>
					<BranchPicker
						branches={branches}
						baseRef={baseRef}
						refreshing={refreshing}
						container={dialogEl}
						onSelect={selectBaseRef}
						onRefresh={() => void refreshBranches()}
					/>
				</div>

				{/* hero: the prompt */}
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
						// Enter creates (matching the button's ↵ affordance); Shift+Enter inserts a newline.
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							void create();
						}
					}}
				/>

				{hasProjectHooks ? (
					<HookModeDisclosure
						open={advancedOpen}
						mode={hookCombineMode ?? projectDefaultMode}
						onToggle={() => setAdvancedOpen((v) => !v)}
						onSelect={setHookCombineMode}
					/>
				) : null}

				{/* controls-bottom: model + effort (left), Create (right) */}
				<div className="flex flex-wrap items-center gap-sm">
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-sm">
						<ModelSelector
							models={models}
							current={model}
							container={dialogEl}
							onSelect={setModel}
						/>
						<ThinkingSelector
							level={thinkingLevel}
							container={dialogEl}
							onSelect={setThinkingLevel}
						/>
					</div>
					<button
						type="button"
						data-testid="create-workspace"
						disabled={creating}
						onClick={() => void create()}
						className="flex h-8 shrink-0 items-center gap-sm rounded-[var(--radius-md)] bg-primary px-md font-medium text-on-accent text-sm outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
					>
						Create
						<span className="inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] bg-[var(--on-accent-16)] px-1 font-[var(--font-mono)] text-xs">
							↵
						</span>
					</button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

/** The project picker pill (defaults to the project the "+" was clicked on). */
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
				<span className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-primary">
					<Box className="size-3 text-on-accent" />
				</span>
				<span className="truncate">{current}</span>
				<ChevronDown className="size-3 shrink-0 text-hint" />
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
									<Box className="size-3.5 shrink-0 text-muted" />
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

/** The base-branch combobox: searchable, grouped Remote/Local, with a Refresh that re-lists branches. */
function BranchPicker({
	branches,
	baseRef,
	refreshing,
	container,
	onSelect,
	onRefresh,
}: {
	branches: BranchList | null;
	baseRef: string;
	refreshing: boolean;
	container: HTMLElement | null;
	onSelect: (ref: string) => void;
	onRefresh: () => void;
}) {
	const [open, setOpen] = useState(false);
	const remote = branches?.remote ?? [];
	const local = branches?.local ?? [];
	const defaultBranch = branches?.defaultBranch;

	const renderItem = (ref: string) => (
		<CommandItem
			key={ref}
			value={ref}
			data-testid="branch-option"
			data-branch={ref}
			onSelect={() => {
				onSelect(ref);
				setOpen(false);
			}}
		>
			<span className="flex w-3.5 shrink-0 justify-center">
				{ref === baseRef ? <Check className="size-3.5 text-primary" /> : null}
			</span>
			<GitBranch className="size-3.5 shrink-0 text-hint" />
			<span className="truncate font-[var(--font-mono)] text-xs">{ref}</span>
			{ref === defaultBranch ? (
				<span className="ml-auto shrink-0 font-[var(--font-mono)] text-hint text-xs">default</span>
			) : null}
		</CommandItem>
	);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				data-testid="ws-branch-picker"
				data-open={open}
				className={`${PILL} max-w-[220px]`}
			>
				<GitBranch className="size-3.5 shrink-0 text-muted" />
				<span className="truncate font-[var(--font-mono)] text-muted text-xs">
					{baseRef || "branch"}
				</span>
				<ChevronDown className="size-3 shrink-0 text-hint" />
			</PopoverTrigger>
			<PopoverContent align="start" container={container} className="w-[320px] p-0">
				<div className="flex items-center justify-end border-border border-b px-sm py-xs">
					<button
						type="button"
						data-testid="branch-refresh"
						aria-label="Refresh branches"
						title="Refresh branches"
						onClick={onRefresh}
						className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-hint outline-none transition-colors hover:bg-hover hover:text-muted focus-visible:ring-2 focus-visible:ring-primary"
					>
						<RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
					</button>
				</div>
				<Command>
					<CommandInput placeholder="Search branches…" />
					<CommandList>
						<CommandEmpty>No branches found.</CommandEmpty>
						{remote.length > 0 ? (
							<CommandGroup heading="Remote">{remote.map(renderItem)}</CommandGroup>
						) : null}
						{local.length > 0 ? (
							<CommandGroup heading="Local">{local.map(renderItem)}</CommandGroup>
						) : null}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

/**
 * The per-workspace hook-mode override, tucked behind an "Advanced" disclosure so it never clutters the
 * default create flow — the parent renders this at all only when the selected project declares at least
 * one Shared/Local hook (`hasProjectHooks`). `mode` defaults to the project's own `combineMode`; picking a
 * different one here threads through `create()` as `Workspace.hookCombineMode`, which then governs that
 * one workspace's hook events for its whole life. Same three choices/labels as `ProjectHooksDialog`'s
 * project-level combine-mode control, kept as a small local toggle here rather than a shared import — the
 * two controls serve different scopes (project default vs. one-off per-workspace override).
 */
function HookModeDisclosure({
	open,
	mode,
	onToggle,
	onSelect,
}: {
	open: boolean;
	mode: CombineMode;
	onToggle: () => void;
	onSelect: (mode: CombineMode) => void;
}) {
	return (
		<div className="flex flex-col gap-xs">
			<button
				type="button"
				data-testid="ws-advanced-toggle"
				aria-expanded={open}
				onClick={onToggle}
				className="flex items-center gap-xs self-start rounded-[var(--radius-sm)] text-hint text-xs outline-none transition-colors hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
			>
				{open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
				Advanced
			</button>
			{open ? (
				<div className="flex flex-col gap-xs pl-md">
					<span className="font-medium text-text text-xs">Hook mode</span>
					<div
						data-testid="ws-hook-mode"
						role="toolbar"
						aria-label="Workspace hook mode"
						className="inline-flex items-center gap-xs self-start rounded-[var(--radius-md)] border border-border2 bg-bg-dark p-0.5"
					>
						{HOOK_MODES.map(({ value, label }) => (
							<button
								key={value}
								type="button"
								data-testid={`ws-hook-mode-${value}`}
								data-active={mode === value}
								aria-pressed={mode === value}
								onClick={() => onSelect(value)}
								className={cn(
									"rounded-[var(--radius-sm)] px-sm py-0.5 text-xs transition-colors",
									mode === value
										? "bg-elevated text-text"
										: "text-hint hover:bg-hover hover:text-text",
								)}
							>
								{label}
							</button>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}
