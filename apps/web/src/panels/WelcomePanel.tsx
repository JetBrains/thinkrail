import type { Workspace } from "@thinkrail/contracts";
import { Folder, FolderOpen, type LucideIcon, Rocket, Sparkles } from "lucide-react";
import { type ComponentPropsWithoutRef, forwardRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PRODUCT_NAME } from "../constants/branding";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { AddProjectMenu } from "./AddProjectMenu";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { ProviderWarningBanner } from "./ProviderWarningBanner";
import { useOpenProject } from "./useOpenProject";

// Seeds the New-Workspace prompt hero for "Set up project" — pi's skill-command syntax `/skill:<name>`,
// which FORCES the setting-up-a-project dispatcher to load (vs. hoping the model auto-matches its
// description). The dispatcher then detects new-vs-existing and routes to starting-a-new-project /
// importing-a-codebase. Still editable in the dialog.
const SETUP_PROMPT = "/skill:setting-up-a-project";

/**
 * The first-touch surface the shell mounts (centered, beside the projects rail) whenever no workspace is
 * active. The ThinkRail wordmark (topbar brand styling, scaled up) over a state-driven pitch and up-to-two
 * cards, adaptive across three states: no projects → "Open project"; a project with specs → "Start
 * building"; a project without a goal-and-requirements.md → a spec-first "Set up project". "Start
 * building" is the intent-first framing of creating a worktree-isolated workspace + kicking off a chat
 * (workspace is the mechanism, not the label).
 */
export function WelcomePanel() {
	const projects = useAppStore((s) => s.projects);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	// The New-Workspace dialog target (null = closed). `prompt` seeds the hero — "" for a plain create,
	// the setup text for "Set up project".
	const [dialog, setDialog] = useState<{ projectId: string; prompt: string } | null>(null);
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

	// The "Open project" card triggers the same dropdown as the projects-rail "+".
	const openProjectCard = ({
		primary = false,
		subtitle,
	}: {
		primary?: boolean;
		subtitle: string;
	}) => (
		<AddProjectMenu
			projects={projects}
			onOpen={() => void pickAndOpen()}
			onOpenRecent={(path) => void openProject(path)}
			align="start"
		>
			<Card
				cta={primary}
				primary={primary}
				icon={FolderOpen}
				title="Open project"
				subtitle={subtitle}
			/>
		</AddProjectMenu>
	);

	return (
		<div
			data-testid="welcome"
			className="flex h-full min-h-0 flex-col items-center justify-center overflow-auto px-xl py-xl text-center"
		>
			{project ? (
				<p className="mb-sm flex max-w-full items-center gap-xs px-md text-muted text-sm">
					<Folder className="size-3.5 shrink-0 text-hint" />
					<span className="truncate font-[var(--font-mono)]">{project.name}</span>
				</p>
			) : null}
			<h1 className="font-[var(--font-accent)] font-extrabold text-[44px] text-primary leading-tight tracking-[0.5px]">
				{PRODUCT_NAME}
			</h1>

			<p className="mt-lg max-w-[440px] text-md text-muted">
				A spec-first way to build with AI. ThinkRail keeps your project's intent as a{" "}
				<span className="text-text">connected spec graph</span> that the agent reads, plans, and
				builds from, all in git worktree isolated workspaces.
			</p>

			<ProviderWarningBanner />

			<div className="mt-xl flex flex-wrap justify-center gap-md">
				{noProjects ? (
					openProjectCard({ primary: true, subtitle: "Choose a local git repository to work in." })
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
						{openProjectCard({ subtitle: "Add another local git repository." })}
					</>
				) : (
					<>
						<Card
							cta
							primary
							icon={Sparkles}
							title="Set up project"
							tag="spec-first"
							subtitle="Prepare the specifications first with the agent before building."
							onClick={() => setDialog({ projectId: project.id, prompt: SETUP_PROMPT })}
						/>
						<Card
							icon={Rocket}
							title="Start building"
							subtitle="Cut an isolated worktree + branch and pair with the agent."
							onClick={() => setDialog({ projectId: project.id, prompt: "" })}
						/>
						{openProjectCard({ subtitle: "Add another local git repository." })}
					</>
				)}
			</div>

			{dialog ? (
				<NewWorkspaceDialog
					open
					projectId={dialog.projectId}
					initialPrompt={dialog.prompt}
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
