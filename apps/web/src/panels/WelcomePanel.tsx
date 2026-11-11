import {
	RiFolderOpenLine as FolderOpen,
	RiHome2Line as House,
	RiChat3Line,
	RiRocketLine as Rocket,
	RiSparkling2Line as Sparkles,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { PRODUCT_NAME } from "../constants/branding";
import {
	selectOnboardingEligible,
	selectRepoProjects,
	selectSupportsOnboarding,
	toast,
	useAppStore,
} from "../store";
import { errorText, getTransport } from "../transport";
import { AddProjectMenu } from "./AddProjectMenu";
import { ConnectedLine, type ConnectedSummary } from "./ConnectedLine";
import { connectedProviderName } from "./ConnectProviderOptions";
import { canStartProjectlessChat, startProjectlessChat } from "./chatActions";
import { enterDefaultWorkspace } from "./defaultWorkspace";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { OnboardingWizard } from "./OnboardingWizard";
import { ProjectTrustNotice } from "./ProjectTrustNotice";
import { ProviderWarningBanner } from "./ProviderWarningBanner";
import {
	setupDialogRequest,
	startProjectSetupChat,
	type WorkspaceDialogRequest,
} from "./setupPrompt";
import { useOpenProject } from "./useOpenProject";
import { useHasProvider } from "./useProviderStatus";
import { Card, CardSkeleton } from "./WelcomeCard";

export function WelcomePanel() {
	const t = useT();
	const projects = useAppStore(useShallow(selectRepoProjects));
	const recentProjects = useAppStore((s) => s.recentProjects);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const supportsOnboarding = useAppStore(selectSupportsOnboarding);
	const onboardingEligible = useAppStore(selectOnboardingEligible);
	const hasProvider = useHasProvider();
	const [dialog, setDialog] = useState<WorkspaceDialogRequest | null>(null);
	const [hasSpecs, setHasSpecs] = useState<boolean | null>(null);
	const wizard = useAppStore((s) => s.onboardingWizard);
	const setWizard = useAppStore((s) => s.setOnboardingWizard);
	const [justConnected, setJustConnected] = useState<ConnectedSummary | null>(null);

	useEffect(() => {
		if (wizard !== "pending" || protocolVersion === null) return;
		if (!onboardingEligible || hasProvider === true) setWizard("hidden");
		else if (hasProvider === false) setWizard("shown");
	}, [wizard, setWizard, protocolVersion, onboardingEligible, hasProvider]);

	useEffect(() => {
		if (hasProvider === false) setJustConnected(null);
	}, [hasProvider]);

	const dismissOnboarding = () => {
		getTransport()
			.request("settings.update", { config: { onboardingDismissed: true } })
			.catch((err) => toast.error(errorText(err), t("panels.onboarding.dismissFailed")));
	};

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

	const { openProject, pickAndOpen, enterHostPath, startNewProject, cloneRepository, dialogs } =
		useOpenProject((opened, { setup }) => {
			useAppStore.getState().selectProject(opened.id, { reveal: true });
			if (setup) void startProjectSetupChat(opened.id);
		});
	const noProjects = project == null;
	const canStartChat = useAppStore(canStartProjectlessChat);
	const showWizard = wizard === "shown" && noProjects;

	useEffect(() => {
		if (wizard === "shown" && !noProjects) setWizard("hidden");
	}, [wizard, noProjects, setWizard]);

	const projectFolderCard = (projectId: string) => (
		<Card
			icon={House}
			title={t("panels.welcome.projectFolderTitle")}
			subtitle={t("panels.welcome.projectFolderSubtitle")}
			onClick={() => void enterDefaultWorkspace(projectId)}
			className="motion-safe:animate-reveal"
		/>
	);

	const openProjectCard = (primary: boolean) => (
		<AddProjectMenu
			recentProjects={recentProjects}
			onOpen={() => void pickAndOpen()}
			onEnterHostPath={enterHostPath}
			onClone={cloneRepository}
			onOpenRecent={(path) => void openProject(path)}
			align="start"
		>
			<Card
				cta={primary}
				primary={primary}
				icon={FolderOpen}
				title={t("panels.welcome.openProjectTitle")}
				subtitle={t("panels.welcome.openProjectSubtitle")}
			/>
		</AddProjectMenu>
	);

	const chatCard = () =>
		canStartChat ? (
			<Card
				icon={RiChat3Line}
				title={t("panels.welcome.chatTitle")}
				subtitle={t("panels.welcome.chatSubtitle")}
				onClick={() => void startProjectlessChat()}
				className="motion-safe:animate-reveal"
			/>
		) : null;

	const noProjectCards = () =>
		supportsOnboarding ? (
			<>
				<Card
					cta
					primary
					icon={Sparkles}
					title={t("panels.welcome.startNewTitle")}
					subtitle={t("panels.welcome.startNewSubtitle")}
					onClick={startNewProject}
				/>
				{openProjectCard(false)}
				{chatCard()}
			</>
		) : (
			<>
				{openProjectCard(true)}
				{chatCard()}
			</>
		);

	return (
		<div
			data-testid="welcome"
			className="flex h-full min-h-0 flex-col items-center justify-center-safe overflow-auto px-24 py-24 text-center"
		>
			{showWizard ? (
				<OnboardingWizard
					projectCards={noProjectCards()}
					onConnected={dismissOnboarding}
					onSkip={() => {
						setWizard("hidden");
						dismissOnboarding();
					}}
				/>
			) : (
				<>
					<h1
						data-testid="welcome-title"
						className="tr-brand-hero max-w-[640px] break-words text-primary"
					>
						{project
							? project.name
							: justConnected
								? t("panels.welcome.connectedTitle")
								: PRODUCT_NAME}
					</h1>
					{noProjects && justConnected ? (
						<div className="mt-12">
							<ConnectedLine summary={justConnected} />
						</div>
					) : null}

					{wizard === "pending" ? null : (
						<ProviderWarningBanner
							hasProvider={hasProvider}
							onConnected={(p) =>
								setJustConnected({
									provider: connectedProviderName(p, t),
									models: null,
									defaultModel: null,
								})
							}
						/>
					)}
					{project ? <ProjectTrustNotice projectId={project.id} /> : null}

					<div className="mt-24 flex flex-wrap justify-center gap-12">
						{noProjects && wizard === "pending" ? (
							<>
								<CardSkeleton />
								<CardSkeleton />
							</>
						) : noProjects ? (
							noProjectCards()
						) : hasSpecs === null ? (
							<>
								<CardSkeleton />
								<CardSkeleton />
							</>
						) : hasSpecs ? (
							<>
								<Card
									cta
									primary
									icon={Rocket}
									title={t("panels.welcome.startBuildingTitle")}
									subtitle={t("panels.welcome.startBuildingSubtitle")}
									onClick={() => setDialog({ projectId: project.id, prompt: "" })}
									className="motion-safe:animate-reveal"
								/>
								{projectFolderCard(project.id)}
							</>
						) : (
							<>
								<Card
									cta
									primary
									icon={Sparkles}
									title={t("panels.welcome.setupTitle")}
									tag={t("panels.welcome.setupTag")}
									subtitle={t("panels.welcome.setupSubtitle")}
									onClick={() => setDialog(setupDialogRequest(project.id))}
									className="motion-safe:animate-reveal"
								/>
								<Card
									icon={Rocket}
									title={t("panels.welcome.startBuildingTitle")}
									subtitle={t("panels.welcome.startBuildingSecondarySubtitle")}
									onClick={() => setDialog({ projectId: project.id, prompt: "" })}
									className="motion-safe:animate-reveal"
								/>
								{projectFolderCard(project.id)}
							</>
						)}
					</div>
				</>
			)}

			{dialog ? (
				<NewWorkspaceDialog
					open
					projectId={dialog.projectId}
					initialPrompt={dialog.prompt}
					{...(dialog.note !== undefined ? { promptNote: dialog.note } : {})}
					onOpenChange={(o) => {
						if (!o) setDialog(null);
					}}
				/>
			) : null}
			{dialogs}
		</div>
	);
}
