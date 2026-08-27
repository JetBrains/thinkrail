import {
	RiFolderOpenLine as FolderOpen,
	RiHome2Line as House,
	type RemixiconComponentType as LucideIcon,
	RiRocketLine as Rocket,
	RiSparkling2Line as Sparkles,
} from "@remixicon/react";
import type { Workspace } from "@thinkrail/contracts";
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

const SETUP_PROMPT = "/skill:setting-up-a-project ";

const SETUP_NOTE =
	"Runs the setting-up-a-project skill — the agent drafts your project's specs, starting from its goal, before building.";

export function WelcomePanel() {
	const projects = useAppStore((s) => s.projects);
	const recentProjects = useAppStore((s) => s.recentProjects);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	const [dialog, setDialog] = useState<{
		projectId: string;
		prompt: string;
		note?: string;
	} | null>(null);
	const [hasSpecs, setHasSpecs] = useState<boolean | null>(null);

	const project = projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null;

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
				if (!cancelled) setHasSpecs(true);
			});
		return () => {
			cancelled = true;
		};
	}, [project?.id]);

	const { openProject, pickAndOpen, enterHostPath, dialogs } = useOpenProject((opened) =>
		useAppStore.getState().selectProject(opened.id, { reveal: true }),
	);

	const onWorkspaceCreated = async (ws: Workspace) => {
		useAppStore
			.getState()
			.setWorkspaces(
				ws.projectId,
				await getTransport().request("workspace.list", { projectId: ws.projectId }),
			);
	};

	const noProjects = project == null;

	const projectFolderCard = (projectId: string) => (
		<Card
			icon={House}
			title="Work in project folder"
			subtitle="Chats, changes, and terminals run directly in your project folder — no isolation."
			onClick={() => void enterDefaultWorkspace(projectId)}
		/>
	);

	const openProjectCard = () => (
		<AddProjectMenu
			recentProjects={recentProjects}
			onOpen={() => void pickAndOpen()}
			onEnterHostPath={enterHostPath}
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
			className="flex h-full min-h-0 flex-col items-center justify-center overflow-auto px-24 py-24 text-center"
		>
			<h1
				data-testid="welcome-title"
				className="tr-brand-hero max-w-[640px] break-words text-primary"
			>
				{project ? project.name : PRODUCT_NAME}
			</h1>

			<ProviderWarningBanner />
			{project ? <ProjectSkillsNotice projectId={project.id} /> : null}

			<div className="mt-24 flex flex-wrap justify-center gap-12">
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
				"relative flex h-[150px] w-[220px] flex-col items-start justify-between rounded-[var(--radius-sm)] border bg-clip-padding p-16 text-left transition-colors",
				primary
					? "border-primary-muted bg-primary-subtle hover:bg-primary-soft"
					: "border-border-default bg-container-workspace-bg hover:border-primary-muted hover:bg-container-elevated-bg",
				className,
			)}
		>
			{tag ? (
				<span className="absolute top-12 right-12 rounded-full border border-primary-muted bg-clip-padding bg-primary-subtle px-8 py-2 tr-text-label-pill text-primary">
					{tag}
				</span>
			) : null}
			<Icon className={cn("size-24", primary ? "text-primary" : "text-text-muted")} />
			<span className="w-full">
				<span className="block tr-title-card text-text-default">{title}</span>
				<span className="mt-2 block text-text-muted tr-text-metadata leading-snug">{subtitle}</span>
			</span>
		</button>
	);
});
