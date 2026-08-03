import type { SlashCommandInfo, ThinkingLevel, WireModel, Workspace } from "@thinkrail/contracts";
import {
	Box,
	ChevronDown,
	GitBranch,
	House,
	type LucideIcon,
	Sparkles,
	TriangleAlert,
} from "lucide-react";
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
import { selectCatalogModel, selectWorkspaceTick, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { BranchPicker } from "./BranchPicker";
import { useBranchList } from "./branches";
import { enterDefaultWorkspace } from "./defaultWorkspace";

/** Where the work runs: cut an isolated worktree, or enter the project folder (Default workspace). */
type WorkspaceTarget = "worktree" | "default";

/**
 * Reconcile the held pre-session model against the catalog: re-point to the same `{provider,id}` entry
 * (the refreshed object, whose `thinkingLevels` may differ). Null means "change nothing";
 * **`"unavailable"`** means "this model is gone — ask the host what to use instead" (the *replacement* is
 * never decided here; see below).
 *
 * Whether a model the catalog *lacks* may be declared gone turns on whether that catalog is authoritative
 * for the question, which is what `catalogFresh` says:
 *
 * - **fresh** — the list *currently held* is the installed result of an awaited forced refresh.
 *   `model.refresh` and the host's `resolveWireModel` read the same registry, and that refresh has
 *   finished, so a missing model really is gone — replacing it beats letting Create fail. (Provenance
 *   lives on the store beside `models` — so the next `model.list` install, from this dialog or any other
 *   consumer, drops it along with the list it described.)
 * - **not fresh** — the app-wide store copy, including anything `model.list` returned (its handler starts
 *   a detached refresh and answers from before it, so the registry can move underneath the reply).
 *   Substituting on that basis would replace a valid host-resolved default with a stale local entry, so
 *   an unconfirmable model is kept until a real refresh settles it.
 *
 * Neither the replacement nor the effort is decided here: `models[0]` would re-derive the host's
 * `pinned ?? available[0]` default policy client-side, so the caller asks `model.default` — authoritative,
 * and it returns an effort consistent with the model it names — exactly as the effort clamp already defers
 * to `model.clampThinking`. No path here invents a policy of its own.
 */
export function reconcileModel(
	models: readonly WireModel[],
	model: WireModel,
	catalogFresh: boolean,
): WireModel | "unavailable" | null {
	const found = selectCatalogModel(models, model);
	if (found) return found;
	return catalogFresh && models.length > 0 ? "unavailable" : null;
}

/** A shared pill-trigger look for the project + branch pickers (mockup `.pill`). */
const PILL =
	"flex h-8 min-w-0 items-center gap-sm rounded-[var(--radius-md)] border border-border-default bg-control-bg px-sm tr-text-ui text-text-default outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[open=true]:border-primary-strong data-[open=true]:bg-control-bg-hovered";

/**
 * The start-working surface: a **target control** chooses where the work runs — an isolated worktree
 * ("Create workspace": pick a base branch, cut a worktree from it) or the project folder itself ("Work
 * in project folder": nothing is created, submit enters the built-in Default workspace). Either way:
 * say what to work on, pick a model + effort, submit → enter the target and **open a fresh chat there**
 * — a typed prompt is sent as its first message, an empty one leaves the composer ready (submitting the
 * start-working surface always lands in a chat, never on a bare receipt). The header is mode-aware so
 * it always names the operation truthfully.
 *
 * The only app-integration piece here: it wires the store + transport. `onCreated(ws)` fires **only when
 * a worktree was created** (folder mode creates nothing — it enters via `enterDefaultWorkspace`, whose
 * list is already fresh and whose activation drives the rail's auto-expand); it lets the parent
 * (ProjectTree) reload its list. The dialog itself kicks off the optional chat.
 */
export function NewWorkspaceDialog({
	open,
	projectId,
	initialPrompt,
	promptNote,
	onOpenChange,
	onCreated,
}: {
	open: boolean;
	/** The project the "+" was clicked on — the picker's default (changeable). */
	projectId: string;
	/** Optional seed for the prompt hero (still fully editable) — e.g. Welcome's "Set up project". */
	initialPrompt?: string;
	/** Optional info strip above the prompt — e.g. what a seeded skill command does (copy owned by the opener). */
	promptNote?: string;
	onOpenChange: (open: boolean) => void;
	onCreated: (workspace: Workspace) => void;
}) {
	const projects = useAppStore((s) => s.projects);

	const [selectedProjectId, setSelectedProjectId] = useState(projectId);
	// Every opener starts on the isolated-worktree side (task-welcome-trim made the entry points
	// uniform — no opener-chosen target exists); the folder alternative is the in-dialog toggle.
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
	// Whether this opening already asked the host to replace a model the catalog dropped (see below).
	const hostDefaultAsked = useRef(false);
	// Ties the two target radios into one native group, unique per dialog instance.
	const targetGroupName = useId();
	// The dialog content node — popovers portal into it so their lists stay scrollable under the Dialog's
	// scroll lock (react-remove-scroll blocks wheel/trackpad on body-portaled content).
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

	// Reset the form each time the dialog opens, anchored to the project the "+" was clicked on and any
	// seed prompt (empty by default).
	useEffect(() => {
		if (!open) return;
		setSelectedProjectId(projectId);
		setPrompt(initialPrompt ?? "");
		setTarget("worktree");
		setCreating(false);
		hostDefaultAsked.current = false;
	}, [open, projectId, initialPrompt]);

	// The picker's list is open projects only — if the selected one is closed by another client while this
	// dialog is up, it drops out from under the picker. Close now rather than let `create()` round-trip to
	// the host's now-enforced rejection.
	useEffect(() => {
		if (!open) return;
		if (projects.some((p) => p.id === selectedProjectId)) return;
		onOpenChange(false);
		toast.info("That project was closed");
	}, [open, projects, selectedProjectId, onOpenChange]);

	// Skills are previewed from the selected project's current checkout; the created worktree/session is
	// authoritative if its base ref differs. Autocomplete is an enhancement, so failure degrades to empty.
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

	// Whether the selected project ships committed skills — a count, so the trust notice is presence-gated
	// (hidden when there's nothing to trust) and never renders the skills' names before trust.
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

	// Models are global to the host — the shared catalog hook re-reads them for this opening (`fresh`)
	// and wires the refresh flow.
	const {
		models,
		refreshing: modelsRefreshing,
		refresh: onRefreshModels,
		fresh: catalogFresh,
	} = useModelCatalog(open);

	// The one place a {model, effort} pair is *chosen* for this not-yet-created session: the host applies
	// pi's own default policy and answers with a level already clamped onto the model it names, so nothing
	// here re-derives either. Both callers below go through it — the preselect on open and the replacement
	// for a model the catalog says is gone. Returns the calling effect's cleanup.
	const applyHostDefault = useCallback(() => {
		let cancelled = false;
		getTransport()
			.request("model.default", {})
			.then((d) => {
				if (cancelled) return;
				setModel(d.model);
				// Self-consistent already (the host clamped the saved level onto this model with the same
				// `clampThinkingLevel` the effect below asks for), so it needs no adjustment here.
				setThinkingLevel(d.thinkingLevel);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	// Preselect the exact model + effort a fresh session would resolve to (so the picker shows the real
	// model, not a placeholder). Passing it back at create time is a no-op vs. the host default.
	useEffect(() => {
		if (!open) return;
		return applyHostDefault();
	}, [open, applyHostDefault]);

	// The stored selection tracks the catalog, so a refresh that changes a model's `thinkingLevels`
	// can't leave the UI and pi's clamp disagreeing, and a model this opening's own snapshot says is
	// gone is replaced rather than left for `create()` to fail on. `catalogFresh` is what separates
	// those two cases from a stale shared copy — see `reconcileModel`. Converges: the reconciled object
	// comes FROM `models`, so the second pass is a no-op. The effort follows the model, either via the
	// host's default here or via its clamp below.
	useEffect(() => {
		if (!open || !model) return;
		const next = reconcileModel(models, model, catalogFresh);
		if (next === null) return;
		if (next !== "unavailable") {
			if (next !== model) setModel(next);
			return;
		}
		// Gone from an authoritative catalog — the host names the replacement. Asked at most once per
		// opening: its answer comes from the same registry the fresh list did, so a still-missing model is a
		// race to leave to `create()`'s error, never something to re-request in a loop.
		if (hostDefaultAsked.current) return;
		hostDefaultAsked.current = true;
		return applyHostDefault();
	}, [open, models, model, catalogFresh, applyHostDefault]);

	// Keep the held effort runnable by the held model. Whenever the two disagree — an explicit model
	// switch, or a catalog refresh that changed what the model supports — ask the host for pi's own
	// `clampThinkingLevel` answer rather than deciding here: `model.default` clamps the same way and a
	// live session gets it from pi directly, so a third, client-side policy would make this the one path
	// that adjusts effort differently. Converges: the clamped level is in the model's set, so the guard
	// then holds. A failed request leaves the level alone; `create()` surfaces the host's error.
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

	// Branches for the selected project (the shared hook: keyed to the project, refreshable, only the initial
	// read degrades). A closed dialog reads nothing. The first answer preselects the default base — empty when
	// git couldn't be read, which makes `create` omit `baseRef` and let the host resolve the real branch — and
	// warms it, so `workspace.create` skips the fetch while the user is still typing.
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
			// Folder mode: nothing is created — the shared helper lists, stores, and activates the project's
			// built-in Default workspace in one atomic entry (and toasts + returns null on failure).
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
				// Worktree creation failed (bad ref, etc.) — keep the dialog open so the user can retry/adjust,
				// and surface the reason (it's otherwise invisible — the dialog just refuses to close).
				toast.error(errorText(err), "Couldn't create workspace");
				setCreating(false);
				return;
			}
		}

		// The target exists — the intent is fulfilled, so close the dialog *now* and run the (slower)
		// chat kick-off in the background. This keeps the dialog from lingering while pi
		// spins up a session, and a kick-off failure can't strand the dialog open.
		const store = useAppStore.getState();
		if (target === "worktree") {
			// Only a real create notifies the parent + activates here — folder mode already entered via the
			// helper (its list is fresh; a re-list would just repeat the host's git work).
			onCreated(workspace);
			store.activateWorkspace(workspace);
		}
		onOpenChange(false);

		// Submitting the start-working surface always lands in a ready chat: create the session (the
		// picked model + effort apply even without a prompt) and open its tab; a typed prompt is
		// additionally sent as the first message — an empty one just leaves the composer focused.
		const text = prompt.trim();
		// Snapshot the sync baseline before the create round-trip (see selectWorkspaceTick / openChatSession).
		const syncedTick = selectWorkspaceTick(useAppStore.getState(), workspace.id);
		try {
			const session = await getTransport().request("session.create", {
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

	// Grant the project trust, then re-preview: the skill effect keys off open/project only, so a grant
	// wouldn't otherwise refresh the catalog. The updated project is folded back into the store so the
	// notice clears (trust rides `Project` through the wire).
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
				className="max-w-[600px] gap-md p-md"
				onEscapeKeyDown={(event) => {
					// Radix handles Escape outside the textarea's React bubble path. Keep the parent dialog open
					// while completion consumes Escape to dismiss only its menu (even if focus moved elsewhere).
					if (!slashCompletion.open) return;
					event.preventDefault();
					slashCompletion.dismiss();
				}}
				onOpenAutoFocus={(e) => {
					// Land focus on the prompt (the hero), not the first picker Radix would otherwise focus.
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

				{/* where: the target control — both modes always visible, the two-mode model in one glance */}
				<fieldset
					data-testid="ws-target"
					className="flex w-fit items-center gap-0.5 rounded-[var(--radius-md)] border border-border-default bg-control-bg p-0.5"
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

				{/* controls-top: project + (worktree mode) base-branch pickers */}
				<div className="flex flex-wrap items-center gap-sm">
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

				{/* Trust gate: a repo's committed skills (`.claude/skills` …) are attacker-controlled for a clone,
				    so they load only after an explicit grant. Personal + bundled skills are always on. */}
				{selectedProject && selectedProject.trusted !== true && aliasSkills.length > 0 ? (
					<div
						data-testid="ws-trust-notice"
						className="flex w-full items-center gap-sm rounded-[var(--radius-md)] border border-border-default border-l-[3px] border-l-feedback-warning bg-feedback-warning-subtle px-md py-sm text-left"
					>
						<TriangleAlert className="size-4 shrink-0 text-feedback-warning" />
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

				{/* hero: the prompt */}
				<div className="relative">
					{promptNote ? (
						<p
							data-testid="ws-prompt-note"
							className="mb-xs flex items-start gap-sm rounded-[var(--radius-md)] border border-primary-muted bg-primary-subtle px-md py-sm text-left text-text-muted tr-text-metadata leading-snug"
						>
							<Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
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
							// Enter creates (matching the button's ↵ affordance); Shift+Enter inserts a newline.
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
							className="absolute top-full left-sm z-50 mt-xs"
						/>
					) : prompt.trim() && isolated ? (
						<p
							data-testid="workspace-naming-hint"
							className="px-xs text-text-subtle tr-text-metadata"
						>
							ThinkRail will name the workspace and branch from your request.
						</p>
					) : (
						<p className="mt-xs text-text-subtle tr-text-metadata">
							Type <span className="tr-code-text">/</span> for a project skill — previewed from the
							current checkout; the created workspace's session is authoritative.
						</p>
					)}
				</div>

				{/* controls-bottom: model + effort (left), Create (right) */}
				<div className="flex flex-wrap items-center gap-sm">
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-sm">
						<ModelSelector
							models={models}
							current={model}
							refreshing={modelsRefreshing}
							onRefresh={onRefreshModels}
							container={dialogEl}
							onSelect={(m) => {
								setModel(m);
								// Pre-session there is no pi to clamp — snap the effort onto the new model's set.
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
						className="flex h-8 shrink-0 items-center gap-sm rounded-[var(--radius-md)] bg-primary px-md tr-text-action text-text-on-primary outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
					>
						{isolated ? "Create" : "Start"}
						<span className="inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] bg-on-primary-soft px-1 tr-code-text">
							↵
						</span>
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

/**
 * One option of the target control — a **native radio** (the two choices are one mutually-exclusive
 * group, which independent toggle buttons would misrepresent to assistive tech), its input visually
 * hidden and the wrapping label wearing the app's active-nav styling. The testid + `data-active` hooks
 * stay on the clickable label; keyboard follows native radio-group behavior.
 */
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
	/** The radio group name tying the options together (unique per dialog instance). */
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
				"flex h-7 cursor-pointer items-center gap-sm rounded-[7px] px-md tr-text-ui transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
				active ? "bg-primary-subtle text-primary" : "text-text-muted hover:text-text-default",
			)}
		>
			<input type="radio" name={name} className="sr-only" checked={active} onChange={onSelect} />
			<Icon className="size-3.5 shrink-0" />
			{label}
		</label>
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
					<Box className="size-3 text-text-on-primary" />
				</span>
				<span className="truncate">{current}</span>
				<ChevronDown className="size-3 shrink-0 text-text-subtle" />
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
									<Box className="size-3.5 shrink-0 text-text-muted" />
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
