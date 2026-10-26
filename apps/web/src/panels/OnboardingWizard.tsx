import {
	RiAlertLine as Alert,
	RiArrowLeftLine as ArrowLeft,
	RiArrowRightLine as ArrowRight,
	RiCpuLine as Cpu,
	RiFileTextLine as FileText,
	RiGitBranchLine as GitBranch,
	RiLoader4Line as Loader,
	type RemixiconComponentType,
} from "@remixicon/react";
import type { DetectedAccount, ProviderStatus } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";
import { PRODUCT_NAME } from "@/constants/branding";
import { selectAnalyticsConsentPromptOpen, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { AnalyticsConsentChoice } from "./AnalyticsPreferences";
import { ConnectedLine, type ConnectedSummary } from "./ConnectedLine";
import { ConnectProviderOptions, connectedProviderName } from "./ConnectProviderOptions";
import { detectAccounts } from "./detectAccounts";
import { useAnalyticsConsent } from "./useAnalyticsConsent";
import { useProviderAuth } from "./useProviderAuth";

type Step = "intro" | "privacy" | "connect";

const FADE_OUT_MS = 200;

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

export function OnboardingWizard({
	projectCards,
	onConnected,
	onSkip,
}: {
	projectCards: ReactNode;
	onConnected: (connected: ConnectedSummary) => void;
	onSkip: () => void;
}) {
	const t = useT();
	const [step, setStep] = useState<Step>("intro");
	const [provider, setProvider] = useState<ProviderStatus | null>(null);
	const [connected, setConnected] = useState<ConnectedSummary | null>(null);
	const [done, setDone] = useState(false);
	const consentOpen = useAppStore(selectAnalyticsConsentPromptOpen);
	const [detected, setDetected] = useState<DetectedAccount[] | null>(null);
	const settingsOpen = useAppStore((s) => s.settingsOpen);
	const auth = useProviderAuth({ ownsLoginDialog: !settingsOpen && step === "connect" });

	return (
		<div
			data-testid="onboarding-wizard"
			data-step={done ? "done" : step}
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
							setStep(consentOpen ? "privacy" : "connect");
							void detectAccounts().then(setDetected);
						}}
					>
						{t("panels.onboarding.intro.start")}
						<ArrowRight className="size-16" />
					</Button>
				</div>
			) : step === "privacy" ? (
				<PrivacyStep onContinue={() => setStep("connect")} />
			) : done && connected ? (
				<div className="flex flex-col items-center gap-24 motion-safe:animate-reveal">
					<h1 data-testid="welcome-title" className="tr-brand-hero break-words text-primary">
						{t("panels.welcome.connectedTitle")}
					</h1>
					<ConnectedLine summary={connected} />
					<div className="flex flex-wrap justify-center gap-12">{projectCards}</div>
				</div>
			) : (
				<div
					className={cn(
						"flex w-full flex-col items-center gap-24 transition-opacity duration-200 ease-out motion-reduce:transition-none",
						connected && "pointer-events-none opacity-0",
					)}
				>
					<div className="flex flex-col items-center gap-8 text-center">
						<h1 data-testid="welcome-title" className="tr-heading-xl break-words text-primary">
							{t("panels.onboarding.connect.title")}
						</h1>
						<p className="tr-text-reading text-text-muted">
							{t("panels.onboarding.connect.subtitle")}
						</p>
					</div>
					<div className="relative w-full">
						<ConnectProviderOptions
							auth={auth}
							detected={detected}
							onConnected={(fresh) => {
								useAppStore.getState().clearLogin();
								setProvider(fresh);
							}}
						/>
						{provider ? (
							<VerifyConnection
								provider={provider}
								onBack={() => setProvider(null)}
								onVerified={(summary) => {
									setConnected(summary);
									onConnected(summary);
									const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
									window.setTimeout(() => setDone(true), reduced ? 0 : FADE_OUT_MS);
								}}
							/>
						) : null}
					</div>
					<Button
						variant="ghost"
						size="sm"
						data-testid="onboarding-skip"
						className="text-text-muted"
						onClick={onSkip}
					>
						{t("panels.onboarding.skip")}
					</Button>
				</div>
			)}

			{step === "intro" ? (
				<Button
					variant="ghost"
					size="sm"
					data-testid="onboarding-skip"
					className="text-text-muted"
					onClick={onSkip}
				>
					{t("panels.onboarding.skip")}
				</Button>
			) : null}
			{auth.loginDialog}
		</div>
	);
}

function PrivacyStep({ onContinue }: { onContinue: () => void }) {
	const t = useT();
	const [draft, setDraft] = useState(true);
	const primed = useRef(false);
	const { pending, error, save, prime } = useAnalyticsConsent();

	useEffect(() => {
		if (primed.current) return;
		primed.current = true;
		prime();
	}, [prime]);

	return (
		<div
			data-testid="onboarding-privacy"
			className="flex w-full max-w-[480px] flex-col items-center gap-24"
		>
			<div className="flex flex-col items-center gap-8 text-center">
				<h1 data-testid="welcome-title" className="tr-heading-xl text-primary">
					{t("panels.analyticsConsent.title")}
				</h1>
				<p className="tr-text-reading text-text-muted">{t("panels.analyticsConsent.subtitle")}</p>
			</div>
			<AnalyticsConsentChoice
				enabled={draft}
				disabled={pending}
				onChange={(enabled) => {
					setDraft(enabled);
					if (!enabled) save(false);
				}}
			/>
			{error ? (
				<p role="alert" className="tr-text-metadata text-feedback-error">
					{error}
				</p>
			) : null}
			<Button
				data-testid="onboarding-privacy-continue"
				disabled={pending}
				onClick={() => {
					save(draft);
					onContinue();
				}}
			>
				{t("panels.analyticsConsent.continue")}
				<ArrowRight className="size-16" />
			</Button>
		</div>
	);
}

function VerifyConnection({
	provider,
	onBack,
	onVerified,
}: {
	provider: ProviderStatus;
	onBack: () => void;
	onVerified: (connected: ConnectedSummary) => void;
}) {
	const t = useT();
	const [empty, setEmpty] = useState(false);
	const name = connectedProviderName(provider);
	const verified = useEffectEvent(onVerified);

	useEffect(() => {
		let cancelled = false;
		const transport = getTransport();
		Promise.all([
			transport.request("model.list", {}),
			transport.request("model.default", {}).catch(() => null),
		]).then(
			([models, fallback]) => {
				if (cancelled) return;
				if (models.length === 0) setEmpty(true);
				else
					verified({
						provider: name,
						models: models.length,
						defaultModel: fallback?.model?.name ?? null,
					});
			},
			() => {
				if (!cancelled) verified({ provider: name, models: null, defaultModel: null });
			},
		);
		return () => {
			cancelled = true;
		};
	}, [name]);

	return (
		<div
			data-testid="onboarding-verify"
			data-state={empty ? "warning" : "verifying"}
			className="absolute inset-0 flex flex-col items-center justify-center gap-12 rounded-sm border border-border-default bg-clip-padding bg-container-workspace-bg p-24 motion-safe:animate-reveal"
		>
			{empty ? (
				<>
					<p
						data-testid="onboarding-no-models"
						className="flex items-start gap-8 text-feedback-warning tr-text-ui"
					>
						<Alert className="mt-2 size-16 shrink-0" />
						{t("panels.onboarding.verify.noModels", { provider: name })}
					</p>
					<Button variant="outline" size="sm" data-testid="onboarding-back" onClick={onBack}>
						<ArrowLeft className="size-16" />
						{t("common.back")}
					</Button>
				</>
			) : (
				<p role="status" className="flex items-center gap-8 text-text-muted tr-text-ui">
					<Loader className="size-16 shrink-0 animate-spin motion-reduce:animate-none" />
					{t("panels.onboarding.verify.checking", { provider: name })}
				</p>
			)}
		</div>
	);
}
