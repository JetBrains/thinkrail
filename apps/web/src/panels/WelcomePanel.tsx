import type { Workspace } from "@thinkrail/contracts";
import { FolderOpen, House, type LucideIcon, Rocket, Sparkles } from "lucide-react";
import { type ComponentPropsWithoutRef, forwardRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PRODUCT_NAME } from "../constants/branding";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { AddProjectMenu } from "./AddProjectMenu";
import { enterDefaultWorkspace } from "./defaultWorkspace";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { ProjectSkillsNotice } from "./ProjectSkillsNotice";
import { ProviderWarningBanner } from "./ProviderWarningBanner";
import { useOpenProject } from "./useOpenProject";

// Seeds the New-Workspace prompt hero for "Set up project" — pi's skill-command syntax `/skill:<name>`,
// which FORCES the setting-up-a-project dispatcher to load (vs. hoping the model auto-matches its
// description). The dispatcher then detects new-vs-existing and routes to starting-a-new-project /
// importing-a-codebase. Still editable in the dialog.
//
// The **trailing space** is load-bearing: it's the same insertion format the slash-command completion
// produces (`selectedSlashCommandValue`), so the seeded value reads as a *completed* command — the
// completion popup stays closed over the seeded hero instead of opening on a bare `/skill:…` query.
// pi's command parser tolerates it (the arg tail is optional).
const SETUP_PROMPT = "/skill:setting-up-a-project ";

// The dialog's info strip for "Set up project" — says what the seeded command actually does (the card
// alone can't: the dialog it opens is the generic create surface). The copy lives here, with the card
// that seeds it, so the dialog stays skill-agnostic.
const SETUP_NOTE =
	"Runs the setting-up-a-project skill — the agent drafts your project's specs, starting from its goal, before building.";

/**
 * The first-touch surface the shell mounts (centered, beside the projects rail) whenever no workspace is
 * active. A single hero heading — the shown project's name, or the ThinkRail wordmark with no project
 * (topbar brand styling, scaled up) — over one-to-three cards, no pitch prose: adaptive across three
 * states: no projects → "Open project" (the only card, and the only state that carries it — with a
 * project shown, opening another lives on the projects-rail "+"); a project with specs → "Start
 * building"; a project without any registered spec → a spec-first "Set up project". With a
 * project shown, Welcome is **the mode fork**: "Start building" (an isolated worktree — the intent-first
 * framing of create + kick off a chat) always sits beside "Work in project folder" (direct-enters the
 * built-in Default workspace), so the two working modes are a visible choice, not a hidden default.
 */
export function WelcomePanel() {
	const projects = useAppStore((s) => s.projects);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	// The New-Workspace dialog opener state (null = closed). `prompt` seeds the hero ("" for a plain
	// create; the setup command for "Set up project", which also carries the explanatory `note`). The
	// dialog always opens on the isolated-worktree target and keeps the folder alternative one click away.
	const [dialog, setDialog] = useState<{
		projectId: string;
		prompt: string;
		note?: string;
	} | null>(null);
	// Whether the shown project has any registered spec, fetched lazily (a full-tree walk — so it's
	// requested only for this one project, on demand, never eagerly for every project on connect).
	// null = pending/unknown (cards wait for it).
	const [hasSpecs, setHasSpecs] = useState<boolean | null>(null);

	// The project the has-specs states key off — the selected one, else the most-recent (list is sorted).
	const project = projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null;

	// Re-check the shown project's specs on demand — keeps the full-tree walk off the connect handshake
	// (the welcome push no longer stamps hasSpecs for every project).
	useEffect(() => {
		const projectId = project?.id;
		if (!projectId) {
			setHasSpecs(null);
			return;
		}
		let cancelled = false;
		setHasSpecs(null);
		getTransport()
			.request("project.hasSpecs", { projectId })
			.then((r) => {
				if (!cancelled) setHasSpecs(r.hasSpecs);
			})
			.catch(() => {
				// Transport error — don't nag "Set up project" on uncertainty; assume specs exist.
				if (!cancelled) setHasSpecs(true);
			});
		return () => {
			cancelled = true;
		};
	}, [project?.id]);

	// The shared open-project flow (offers to git-init a non-git folder, or shows a legible error). Its
	// adopt step just selects the project — the visible rail reflects it; there's no tree to expand here.
	const { openProject, pickAndOpen, dialogs } = useOpenProject((opened) =>
		useAppStore.getState().selectProject(opened.id),
	);

	// A workspace was created from the welcome dialog: refresh that project's list (the dialog itself sets
	// the active workspace, which swaps the shell to the workspace surface — this view then unmounts).
	const onWorkspaceCreated = async (ws: Workspace) => {
		useAppStore
			.getState()
			.setWorkspaces(
				ws.projectId,
				await getTransport().request("workspace.list", { projectId: ws.projectId }),
			);
	};

	const noProjects = project == null;

	// The fork's "no isolation" card — identical in both project states, so it's built once. It
	// direct-enters the project's built-in Default workspace, no dialog (it's navigation; the Default
	// receipt + New chat cover kick-off): the shared helper lists, stores, and activates in one step,
	// degrading to its error toast on an older host with no Default.
	const projectFolderCard = (projectId: string) => (
		<Card
			icon={House}
			title="Work in project folder"
			subtitle="Chats, changes, and terminals run directly in your project folder — no isolation."
			onClick={() => void enterDefaultWorkspace(projectId)}
		/>
	);

	// The "Open project" card — only rendered in the no-projects state (with a project shown, the
	// projects-rail "+" carries this same dropdown). Triggers the same menu as that "+".
	const openProjectCard = () => (
		<AddProjectMenu
			projects={projects}
			onOpen={() => void pickAndOpen()}
			onOpenRecent={(path) => void openProject(path)}
			align="start"
		>
			<Card
				cta
				primary
				icon={FolderOpen}
				title="Open project"
				subtitle="Choose a local git repository to work in."
			/>
		</AddProjectMenu>
	);

	return (
		<div
			data-testid="welcome"
			className="flex h-full min-h-0 flex-col items-center justify-center overflow-auto px-xl py-xl text-center"
		>
			<h1
				data-testid="welcome-title"
				className="max-w-[640px] break-words font-[var(--font-accent)] font-extrabold text-[44px] text-primary leading-tight tracking-[0.5px]"
			>
				{project ? project.name : PRODUCT_NAME}
			</h1>

			<ProviderWarningBanner />
			{project ? <ProjectSkillsNotice projectId={project.id} /> : null}

			<div className="mt-xl flex flex-wrap justify-center gap-md">
				{noProjects ? (
					openProjectCard()
				) : hasSpecs === null ? null : hasSpecs ? (
					<>
						<Card
							cta
							primary
							icon={Rocket}
							title="Start building"
							subtitle="Cut an isolated worktree + branch, then pair with the agent to build it."
							onClick={() => setDialog({ projectId: project.id, prompt: "" })}
						/>
						{projectFolderCard(project.id)}
					</>
				) : (
					<>
						<Card
							cta
							primary
							icon={Sparkles}
							title="Set up project"
							tag="spec-first"
							subtitle="Draft the project's specs with the agent before building, starting from its goal."
							onClick={() =>
								setDialog({
									projectId: project.id,
									prompt: SETUP_PROMPT,
									note: SETUP_NOTE,
								})
							}
						/>
						<Card
							icon={Rocket}
							title="Start building"
							subtitle="Cut an isolated worktree + branch and pair with the agent."
							onClick={() => setDialog({ projectId: project.id, prompt: "" })}
						/>
						{projectFolderCard(project.id)}
					</>
				)}
			</div>

			{dialog ? (
				<NewWorkspaceDialog
					open
					projectId={dialog.projectId}
					initialPrompt={dialog.prompt}
					{...(dialog.note !== undefined ? { promptNote: dialog.note } : {})}
					onOpenChange={(o) => {
						if (!o) setDialog(null);
					}}
					onCreated={(ws) => void onWorkspaceCreated(ws)}
				/>
			) : null}
			{dialogs}
		</div>
	);
}

/**
 * One welcome card (Conductor-style: icon top-left, label + explainer bottom-left). The state's primary
 * is a filled-violet card carrying the stable `welcome-cta` hook; others are quiet outlined
 * `welcome-action`s. A `forwardRef` so it can serve as a Radix `asChild` trigger (the "Open project" card
 * hangs the `AddProjectMenu` dropdown off it).
 */
type CardProps = {
	cta?: boolean;
	primary?: boolean;
	icon: LucideIcon;
	title: string;
	subtitle: string;
	tag?: string;
} & ComponentPropsWithoutRef<"button">;

const Card = forwardRef<HTMLButtonElement, CardProps>(function Card(
	{ cta, primary, icon: Icon, title, subtitle, tag, className, ...rest },
	ref,
) {
	return (
		<button
			ref={ref}
			type="button"
			data-testid={cta ? "welcome-cta" : "welcome-action"}
			{...rest}
			className={cn(
				"relative flex h-[150px] w-[220px] flex-col items-start justify-between rounded-[var(--radius-lg)] border p-lg text-left transition-colors",
				primary
					? "border-[var(--primary-40)] bg-[var(--primary-10)] hover:bg-[var(--primary-20)]"
					: "border-border2 bg-bg hover:border-[var(--primary-40)] hover:bg-elevated",
				className,
			)}
		>
			{tag ? (
				<span className="absolute top-md right-md rounded-full border border-[var(--primary-40)] bg-[var(--primary-10)] px-sm py-0.5 font-[var(--font-mono)] text-[10px] text-primary uppercase tracking-wide">
					{tag}
				</span>
			) : null}
			<span
				className={cn(
					"flex size-9 items-center justify-center rounded-[10px]",
					primary ? "bg-primary text-on-accent" : "bg-hover text-muted",
				)}
			>
				<Icon className="size-4" />
			</span>
			<span className="w-full">
				<span className="block font-medium text-sm text-text">{title}</span>
				<span className="mt-0.5 block text-muted text-xs leading-snug">{subtitle}</span>
			</span>
		</button>
	);
});
