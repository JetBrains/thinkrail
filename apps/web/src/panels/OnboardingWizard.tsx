import {
	RiAlertLine as Alert,
	RiArrowLeftLine as ArrowLeft,
	RiArrowRightLine as ArrowRight,
	RiCheckLine as Check,
	RiCpuLine as Cpu,
	RiFileTextLine as FileText,
	RiFolderOpenLine as FolderOpen,
	RiGitBranchLine as GitBranch,
	type RemixiconComponentType,
	RiRocketLine as Rocket,
	RiSparkling2Line as Sparkles,
} from "@remixicon/react";
import type { DetectedAccount, Project, ProviderStatus, WireModel } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { T, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { SkeletonRows } from "@thinkrail/ui/skeleton";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useState } from "react";
import { PRODUCT_NAME } from "@/constants/branding";
import { useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { AddProjectMenu } from "./AddProjectMenu";
import { ConnectProviderOptions, connectedProviderName } from "./ConnectProviderOptions";
import { detectAccounts } from "./detectAccounts";
import { setupDialogRequest, type WorkspaceDialogRequest } from "./setupPrompt";
import { useOpenProject } from "./useOpenProject";
import { useProviderAuth } from "./useProviderAuth";
import { Card } from "./WelcomeCard";

type Step = "intro" | "connect" | "verify" | "project" | "build";
type HeaderStep = "connect" | "project" | "build";

const INTRO_BEATS = [
	{
		icon: GitBranch,
		title: "panels.onboarding.intro.worktreesTitle",
		detail: "panels.onboarding.intro.worktreesDetail",
	},
	{
		icon: FileText,
		title: "panels.onboarding.intro.specsTitle",
		detail: "panels.onboarding.intro.specsDetail",
	},
	{
		icon: Cpu,
		title: "panels.onboarding.intro.engineTitle",
		detail: "panels.onboarding.intro.engineDetail",
	},
] as const satisfies readonly {
	icon: RemixiconComponentType;
	title: MessageKey;
	detail: MessageKey;
}[];

const STEPS: { id: HeaderStep; label: MessageKey }[] = [
	{ id: "connect", label: "panels.onboarding.step.connect" },
	{ id: "project", label: "panels.onboarding.step.project" },
	{ id: "build", label: "panels.onboarding.step.build" },
];

export function OnboardingWizard({
	onFinish,
}: {
	onFinish: (request: WorkspaceDialogRequest | null) => void;
}) {
	const t = useT();
	const [step, setStep] = useState<Step>("intro");
	const [provider, setProvider] = useState<ProviderStatus | null>(null);
	const [detected, setDetected] = useState<DetectedAccount[] | null>(null);
	const [project, setProject] = useState<Project | null>(null);
	const settingsOpen = useAppStore((s) => s.settingsOpen);
	const recentProjects = useAppStore((s) => s.recentProjects);
	const auth = useProviderAuth({ ownsLoginDialog: !settingsOpen && step === "connect" });
	const { openProject, pickAndOpen, enterHostPath, startNewProject, dialogs } = useOpenProject(
		(opened) => {
			useAppStore.getState().selectProject(opened.id, { reveal: true });
			setProject(opened);
			setStep("build");
		},
	);

	return (
		<div
			data-testid="onboarding-wizard"
			data-step={step}
			className="flex w-full max-w-[640px] flex-col items-center gap-24"
		>
			{step === "intro" ? (
				<div
					data-testid="onboarding-intro"
					className="flex flex-col items-center gap-24 text-center"
				>
					<div className="flex flex-col items-center gap-8">
						<span className="tr-text-eyebrow text-text-muted">
							{t("panels.onboarding.intro.welcomeTo")}
						</span>
						<h1 data-testid="welcome-title" className="tr-brand-hero text-primary">
							{PRODUCT_NAME}
						</h1>
						<p className="tr-heading-sm text-text-default">
							{t("panels.onboarding.intro.tagline")}
						</p>
					</div>
					<ul className="grid w-full gap-12 sm:grid-cols-3">
						{INTRO_BEATS.map(({ icon: Icon, title, detail }) => (
							<li
								key={title}
								className="flex flex-col gap-8 rounded-sm border border-border-default bg-clip-padding bg-container-workspace-bg p-16 text-left"
							>
								<Icon className="size-16 text-primary" />
								<span className="tr-title-card text-text-default">{t(title)}</span>
								<span className="text-text-muted tr-text-metadata">{t(detail)}</span>
							</li>
						))}
					</ul>
					<Button
						data-testid="onboarding-start"
						onClick={() => {
							setStep("connect");
							void detectAccounts().then(setDetected);
						}}
					>
						{t("panels.onboarding.intro.start")}
						<ArrowRight className="size-16" />
					</Button>
				</div>
			) : step === "connect" ? (
				<>
					<StepTitle
						step="connect"
						title={t("panels.onboarding.connect.title")}
						subtitle={t("panels.onboarding.connect.subtitle")}
					/>
					<div className="w-full">
						<ConnectProviderOptions
							auth={auth}
							detected={detected}
							onShowAll={() => useAppStore.getState().openSettings("providers")}
							onConnected={(connected) => {
								useAppStore.getState().clearLogin();
								setProvider(connected);
								setStep("verify");
							}}
						/>
					</div>
				</>
			) : step === "verify" && provider ? (
				<VerifyStep
					provider={provider}
					onBack={() => setStep("connect")}
					onContinue={() => setStep("project")}
				/>
			) : step === "project" ? (
				<>
					<StepTitle
						step="project"
						title={t("panels.onboarding.project.title")}
						subtitle={t("panels.onboarding.project.subtitle")}
					/>
					<div className="flex flex-wrap justify-center gap-12">
						<Card
							cta
							primary
							icon={Sparkles}
							title={t("panels.welcome.startNewTitle")}
							subtitle={t("panels.welcome.startNewSubtitle")}
							onClick={() => startNewProject({ offerSetup: false })}
						/>
						<AddProjectMenu
							recentProjects={recentProjects}
							onOpen={() => void pickAndOpen()}
							onEnterHostPath={enterHostPath}
							onOpenRecent={(path) => void openProject(path)}
							align="start"
						>
							<Card
								icon={FolderOpen}
								title={t("panels.onboarding.project.openTitle")}
								subtitle={t("panels.onboarding.project.openSubtitle")}
							/>
						</AddProjectMenu>
					</div>
				</>
			) : step === "build" && project ? (
				<>
					<StepTitle
						step="build"
						title={t("panels.onboarding.build.title", { project: project.name })}
						subtitle={t("panels.onboarding.build.subtitle")}
					/>
					<div className="flex flex-wrap justify-center gap-12">
						<Card
							cta
							primary
							icon={Sparkles}
							title={t("panels.welcome.setupTitle")}
							tag={t("panels.welcome.setupTag")}
							subtitle={t("panels.welcome.setupSubtitle")}
							onClick={() => onFinish(setupDialogRequest(project.id))}
						/>
						<Card
							icon={Rocket}
							title={t("panels.welcome.startBuildingTitle")}
							subtitle={t("panels.welcome.startBuildingSecondarySubtitle")}
							onClick={() => onFinish({ projectId: project.id, prompt: "" })}
						/>
					</div>
				</>
			) : null}

			<Button
				variant="ghost"
				size="sm"
				data-testid="onboarding-skip"
				className="text-text-muted"
				onClick={() => onFinish(null)}
			>
				{t("panels.onboarding.skip")}
			</Button>
			{auth.loginDialog}
			{dialogs}
		</div>
	);
}

function StepHeader({ current }: { current: HeaderStep }) {
	const t = useT();
	const currentIndex = STEPS.findIndex((s) => s.id === current);
	return (
		<ol data-testid="onboarding-steps" className="flex items-center gap-8">
			{STEPS.map((s, index) => {
				const done = index < currentIndex;
				const active = index === currentIndex;
				return (
					<li
						key={s.id}
						data-step={s.id}
						data-state={done ? "done" : active ? "current" : "upcoming"}
						aria-current={active ? "step" : undefined}
						className="flex items-center gap-8"
					>
						{index > 0 ? (
							<span
								aria-hidden="true"
								className={cn("h-px w-24", done || active ? "bg-primary" : "bg-border-default")}
							/>
						) : null}
						<span
							className={cn(
								"grid size-20 place-items-center rounded-full border tr-text-caption",
								done
									? "border-primary bg-primary text-control-primary-text"
									: active
										? "border-primary text-primary"
										: "border-border-default text-text-muted",
							)}
						>
							{done ? <Check className="size-12" /> : index + 1}
						</span>
						<span
							className={cn("tr-text-metadata", active ? "text-text-default" : "text-text-muted")}
						>
							{t(s.label)}
						</span>
					</li>
				);
			})}
		</ol>
	);
}

function StepTitle({
	step,
	title,
	subtitle,
}: {
	step: HeaderStep;
	title: string;
	subtitle: string;
}) {
	return (
		<div className="flex flex-col items-center gap-16 text-center">
			<div className="flex flex-col items-center gap-8">
				<h1 data-testid="welcome-title" className="tr-heading-xl break-words text-primary">
					{title}
				</h1>
				<p className="tr-text-reading text-text-muted">{subtitle}</p>
			</div>
			<StepHeader current={step} />
		</div>
	);
}

function VerifyStep({
	provider,
	onBack,
	onContinue,
}: {
	provider: ProviderStatus;
	onBack: () => void;
	onContinue: () => void;
}) {
	const t = useT();
	const [models, setModels] = useState<WireModel[] | null>(null);
	const [defaultModel, setDefaultModel] = useState<WireModel | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const transport = getTransport();
		Promise.all([transport.request("model.list", {}), transport.request("model.default", {})])
			.then(([list, fallback]) => {
				if (cancelled) return;
				setModels(list);
				setDefaultModel(fallback.model);
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const name = connectedProviderName(provider);
	const empty = models !== null && models.length === 0;

	return (
		<>
			<StepTitle
				step="connect"
				title={t("auth.login.connectedTitle", { provider: name })}
				subtitle={t("panels.onboarding.verify.subtitle")}
			/>
			<div
				data-testid="onboarding-verify"
				className="flex w-full max-w-[420px] flex-col gap-8 rounded-sm border border-border-default bg-container-workspace-bg p-16 text-left"
			>
				{failed ? (
					<p className="text-text-muted tr-text-ui">{t("panels.onboarding.verify.loadFailed")}</p>
				) : models === null ? (
					<SkeletonRows rows={2} />
				) : empty ? (
					<p
						data-testid="onboarding-no-models"
						className="flex items-start gap-8 text-feedback-warning tr-text-ui"
					>
						<Alert className="mt-2 size-16 shrink-0" />
						{t("panels.onboarding.verify.noModels", { provider: name })}
					</p>
				) : (
					<>
						<p
							data-testid="onboarding-model-count"
							className="flex items-center gap-8 text-feedback-success tr-text-ui"
						>
							<Check className="size-16 shrink-0" />
							{t("panels.connectProvider.modelsAvailable", { count: models.length })}
						</p>
						{defaultModel ? (
							<p className="text-text-muted tr-text-metadata">
								<T
									i18nKey="panels.onboarding.verify.defaultModel"
									values={{ model: defaultModel.name }}
									components={[<span key="model" className="tr-text-emphasis text-text-default" />]}
								/>
							</p>
						) : null}
					</>
				)}
			</div>
			<div className="flex gap-8">
				<Button variant="outline" data-testid="onboarding-back" onClick={onBack}>
					<ArrowLeft className="size-16" />
					{t("common.back")}
				</Button>
				<Button data-testid="onboarding-continue" onClick={onContinue}>
					{t("panels.onboarding.continue")}
				</Button>
			</div>
		</>
	);
}
