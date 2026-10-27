import {
	RiAlertLine as AlertTriangle,
	RiCheckLine as Check,
	RiFileCopyLine as Copy,
	RiExternalLinkLine as ExternalLink,
	RiLoader4Line as Loader2,
	RiLogoutBoxLine as LogOut,
	RiPlayLine as Play,
	RiRefreshLine as RefreshCw,
	RiToolsLine as Wrench,
} from "@remixicon/react";
import {
	isJbcentralQuotaRefreshSeconds,
	JBCENTRAL_QUOTA_REFRESH_SECONDS,
	type JbcentralAction,
	type JbcentralActionFailureReason,
	type JbcentralActionResult,
	type JbcentralInstall,
	type JbcentralStatus,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "@/lib";
import { getTransport } from "@/transport";
import { SettingsSwitch } from "./SettingsSwitch";

const LOGIN_CMD = "central login";

type Notice =
	| { kind: "failed"; action: JbcentralAction; reason: JbcentralActionFailureReason }
	| { kind: "transport-failed"; action: JbcentralAction }
	| { kind: "login-launched" }
	| { kind: "login-failed" };

interface JbcentralQuotaSettingsProps {
	enabled: boolean;
	refreshSeconds: number;
	onEnabledChange: (enabled: boolean) => Promise<void>;
	onRefreshSecondsChange: (seconds: number) => Promise<void>;
}

function JbcentralQuotaSettings({
	enabled,
	refreshSeconds,
	onEnabledChange,
	onRefreshSecondsChange,
}: JbcentralQuotaSettingsProps) {
	const t = useT();
	const savedText = String(refreshSeconds);
	const [draft, setDraft] = useState(savedText);
	const [submitted, setSubmitted] = useState<string | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);

	useEffect(() => {
		setDraft(savedText);
		setSubmitted(null);
	}, [savedText]);

	const invalid = !isJbcentralQuotaRefreshSeconds(Number(draft));
	const error = invalid
		? t("settings.jbcentral.quota.invalid", {
				min: JBCENTRAL_QUOTA_REFRESH_SECONDS.min,
				max: JBCENTRAL_QUOTA_REFRESH_SECONDS.max,
			})
		: saveError;
	const errorId = "jbcentral-quota-interval-error";

	const commitInterval = () => {
		if (invalid || draft === savedText || draft === submitted) return;
		setSubmitted(draft);
		setSaveError(null);
		onRefreshSecondsChange(Number(draft)).catch(() => {
			setDraft(savedText);
			setSubmitted(null);
			setSaveError(t("settings.jbcentral.quota.intervalSaveFailed"));
		});
	};

	return (
		<div
			data-testid="jbcentral-quota-settings"
			className="flex flex-col border-border-muted border-t"
		>
			<div className="flex items-center justify-between gap-12 border-border-muted border-b py-12">
				<span className="text-text-default tr-text-ui">{t("settings.jbcentral.quota.show")}</span>
				<SettingsSwitch
					checked={enabled}
					label={t("settings.jbcentral.quota.showLabel")}
					testId="jbcentral-quota-toggle"
					onChange={(next) => {
						setSaveError(null);
						void onEnabledChange(next).catch(() =>
							setSaveError(t("settings.jbcentral.quota.displaySaveFailed")),
						);
					}}
				/>
			</div>

			<div className="flex items-center justify-between gap-12 py-12">
				<label htmlFor="jbcentral-quota-interval" className="text-text-default tr-text-ui">
					{t("settings.jbcentral.quota.interval")}
				</label>
				<input
					id="jbcentral-quota-interval"
					type="number"
					inputMode="numeric"
					data-testid="jbcentral-quota-interval"
					data-settings-draft-input
					min={JBCENTRAL_QUOTA_REFRESH_SECONDS.min}
					max={JBCENTRAL_QUOTA_REFRESH_SECONDS.max}
					step={1}
					value={draft}
					disabled={!enabled}
					aria-invalid={invalid}
					aria-describedby={error ? errorId : undefined}
					onChange={(event) => {
						setDraft(event.currentTarget.value);
						setSubmitted(null);
						setSaveError(null);
					}}
					onBlur={commitInterval}
					onKeyDown={(event) => {
						if (isImeComposing(event.nativeEvent)) return;
						if (event.key === "Enter") {
							event.preventDefault();
							event.currentTarget.blur();
						} else if (event.key === "Escape") {
							setDraft(savedText);
							setSaveError(null);
						}
					}}
					className="h-32 w-64 rounded-sm border border-control-border-default bg-control-bg px-8 tr-text-ui text-text-default outline-none focus:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text aria-invalid:border-feedback-error"
				/>
			</div>

			{error ? (
				<p
					id={errorId}
					data-testid="jbcentral-quota-interval-error"
					className="pb-12 text-feedback-error tr-text-metadata"
				>
					{error}
				</p>
			) : null}
		</div>
	);
}

export function JetBrainsAiCard({
	status,
	install,
	onChanged,
	quotaSettings,
}: {
	status: JbcentralStatus;
	install: JbcentralInstall;
	onChanged: () => void | Promise<void>;
	quotaSettings?: JbcentralQuotaSettingsProps;
}) {
	const t = useT();
	const [busyAction, setBusyAction] = useState<JbcentralAction | null>(null);
	const [notice, setNotice] = useState<Notice | null>(null);
	const [signingIn, setSigningIn] = useState(false);

	useEffect(() => {
		if (status.state !== "configuring") return;
		const timer = setInterval(() => void onChanged(), 500);
		return () => clearInterval(timer);
	}, [status.state, onChanged]);

	const demandedSignIn = useRef(isSignedOut(status));
	useEffect(() => {
		const signedOut = isSignedOut(status);
		const resolved = demandedSignIn.current && !signedOut;
		demandedSignIn.current = signedOut;
		if (status.state !== "configured" && !resolved) return;
		setNotice((current) =>
			current?.kind === "login-launched" || current?.kind === "login-failed" ? null : current,
		);
	}, [status]);

	const runAction = useCallback(
		async (action: JbcentralAction) => {
			setBusyAction(action);
			setNotice(null);
			const run = async () => {
				const result: JbcentralActionResult =
					action === "connect"
						? await getTransport().request("provider.jbcentralConnect", {})
						: action === "disconnect"
							? await getTransport().request("provider.jbcentralDisconnect", {})
							: action === "start-proxy"
								? await getTransport().request("provider.jbcentralStartProxy", {})
								: await getTransport().request("provider.jbcentralUpdate", {});
				if (result.outcome === "failed") {
					setNotice({ kind: "failed", action, reason: result.reason });
				}
				await onChanged();
			};
			await run()
				.catch(() => setNotice({ kind: "transport-failed", action }))
				.finally(() => setBusyAction(null));
		},
		[onChanged],
	);

	const signIn = useCallback(async () => {
		if (signingIn) return;
		setSigningIn(true);
		const login = async () => {
			const result = await getTransport().request("provider.jbcentralLogin", {});
			setNotice(
				result.outcome === "launched" ? { kind: "login-launched" } : { kind: "login-failed" },
			);
			if (result.outcome === "launched") await onChanged();
		};
		await login()
			.catch(() => setNotice({ kind: "login-failed" }))
			.finally(() => setSigningIn(false));
	}, [signingIn, onChanged]);

	const visibleState = busyAction ? "configuring" : status.state;
	const signedOut = isSignedOut(status);
	const installed = status.state !== "absent";
	const configured = status.state === "configured";
	const primaryAction = actionForStatus(status);
	const retryAction = status.state === "load-failed" ? retryActionFor(status) : null;

	return (
		<section
			data-testid="jetbrains-ai-card"
			data-state={visibleState}
			data-configured={configured}
			data-installed={installed}
			className="flex flex-col gap-8"
		>
			<div className="flex items-center justify-between gap-12">
				<h3 className="tr-text-label-pill text-text-subtle">{t("settings.jbcentral.title")}</h3>
				<div className="flex shrink-0 items-center gap-4">
					{busyAction ? (
						<Button size="sm" disabled data-testid="jetbrains-configuring">
							<Loader2 className="size-14 animate-spin" />
							{t(ACTION_BUSY_LABEL[busyAction])}
						</Button>
					) : signedOut ? (
						<SignInButton
							label={t("settings.jbcentral.signIn")}
							signingIn={signingIn}
							onSignIn={() => void signIn()}
						/>
					) : status.state === "load-failed" && retryAction ? (
						<>
							<Button
								size="sm"
								data-testid="jetbrains-retry"
								onClick={() => void runAction(retryAction)}
							>
								<RefreshCw className="size-14" />
								{t("common.retry")}
							</Button>
							{status.configured ? (
								<ActionButton action="disconnect" onAction={() => void runAction("disconnect")} />
							) : null}
						</>
					) : primaryAction ? (
						<ActionButton action={primaryAction} onAction={() => void runAction(primaryAction)} />
					) : needsRecheck(status) ? (
						<Button
							variant="ghost"
							size="sm"
							data-testid="jetbrains-recheck"
							onClick={() => void onChanged()}
						>
							<RefreshCw className="size-14" />
							{t("settings.jbcentral.recheck")}
						</Button>
					) : null}
				</div>
			</div>

			<StatusBody status={status} install={install} onChanged={onChanged} />

			{notice?.kind === "failed" || notice?.kind === "transport-failed" ? (
				<div className="flex flex-col gap-4" data-testid="jetbrains-error">
					<p className="text-feedback-error tr-text-metadata">
						{notice.kind === "failed"
							? t(failureText(notice.action, notice.reason))
							: t("settings.jbcentral.transportFailed")}
					</p>
					{!signedOut &&
					notice.action === "connect" &&
					(notice.kind === "transport-failed" || notice.reason === "central-action-failed") ? (
						<SignInGuidance signingIn={signingIn} onSignIn={() => void signIn()} />
					) : null}
				</div>
			) : null}

			{notice?.kind === "login-launched" ? (
				<p className="text-text-muted tr-text-metadata" data-testid="jetbrains-login-launched">
					{t("settings.jbcentral.loginLaunched")}
				</p>
			) : notice?.kind === "login-failed" ? (
				<div className="flex flex-col gap-4" data-testid="jetbrains-login-failed">
					<p className="text-feedback-error tr-text-metadata">
						{t("settings.jbcentral.loginFailed")}
					</p>
					<CopyableCommand command={LOGIN_CMD} />
				</div>
			) : null}

			{quotaSettings ? <JbcentralQuotaSettings {...quotaSettings} /> : null}
		</section>
	);
}

function ActionButton({ action, onAction }: { action: JbcentralAction; onAction: () => void }) {
	const t = useT();
	const disconnect = action === "disconnect";
	return (
		<Button
			variant={disconnect ? "outline" : "default"}
			size="sm"
			data-testid={`jetbrains-${action}`}
			onClick={onAction}
		>
			{disconnect ? (
				<LogOut className="size-14" />
			) : action === "update" ? (
				<Wrench className="size-14" />
			) : action === "start-proxy" ? (
				<Play className="size-14" />
			) : null}
			{t(ACTION_LABEL[action])}
		</Button>
	);
}

function StatusBody({
	status,
	install,
	onChanged,
}: {
	status: JbcentralStatus;
	install: JbcentralInstall;
	onChanged: () => void | Promise<void>;
}) {
	const t = useT();
	if (isSignedOut(status)) return <SignedOutNotice />;

	switch (status.state) {
		case "absent":
			return (
				<div className="flex flex-col gap-4" data-testid="jetbrains-needs-install">
					<p className="text-text-muted tr-text-metadata">{t("settings.jbcentral.needsInstall")}</p>
					<CopyableCommand command={install.command} />
					<Button
						variant="ghost"
						size="sm"
						data-testid="jetbrains-recheck"
						onClick={() => void onChanged()}
						className="self-start"
					>
						<RefreshCw className="size-14" />
						{t("settings.jbcentral.recheck")}
					</Button>
				</div>
			);
		case "outdated":
			return (
				<p className="text-feedback-warning tr-text-metadata" data-testid="jetbrains-outdated">
					{t("settings.jbcentral.outdated", { version: status.version })}
				</p>
			);
		case "supported":
			return (
				<p className="text-feedback-success tr-text-metadata" data-testid="jetbrains-ready">
					{t("settings.jbcentral.ready")}
				</p>
			);
		case "configured":
			return status.proxyStopped ? (
				<p
					className="flex items-start gap-4 text-feedback-warning tr-text-metadata"
					data-testid="jetbrains-proxy-stopped"
				>
					<AlertTriangle className="mt-2 size-14 shrink-0" />
					{t("settings.jbcentral.proxyStopped")}
				</p>
			) : (
				<p
					className="flex items-center gap-4 text-feedback-success tr-text-metadata"
					data-testid="jetbrains-connected"
				>
					<Check className="size-14 shrink-0" />
					{t("settings.jbcentral.connected")}
				</p>
			);
		case "malformed-version":
			return (
				<p className="text-feedback-error tr-text-metadata" data-testid="jetbrains-version-error">
					{t("settings.jbcentral.malformedVersion")}
				</p>
			);
		case "probe-failed":
			return (
				<p className="text-feedback-error tr-text-metadata" data-testid="jetbrains-version-error">
					{t("settings.jbcentral.probeFailed")}
				</p>
			);
		case "configuring":
			return (
				<p className="flex items-center gap-4 text-text-muted tr-text-metadata">
					<Loader2 className="size-14 animate-spin" />
					{status.action ? t(ACTION_PROGRESS[status.action]) : t("settings.jbcentral.applying")}
				</p>
			);
		case "load-failed":
			return (
				<p
					className="flex items-start gap-4 text-feedback-error tr-text-metadata"
					data-testid="jetbrains-load-failed"
				>
					<AlertTriangle className="mt-2 size-14 shrink-0" />
					{t("settings.jbcentral.loadFailed")}
				</p>
			);
	}
}

function SignInButton({
	signingIn,
	onSignIn,
	label,
}: {
	signingIn: boolean;
	onSignIn: () => void;
	label: string;
}) {
	return (
		<Button
			variant="soft"
			size="sm"
			data-testid="jetbrains-signin"
			disabled={signingIn}
			onClick={onSignIn}
			className="self-start"
		>
			{signingIn ? (
				<Loader2 className="size-14 animate-spin" />
			) : (
				<ExternalLink className="size-14" />
			)}
			{label}
		</Button>
	);
}

function SignInGuidance({ signingIn, onSignIn }: { signingIn: boolean; onSignIn: () => void }) {
	const t = useT();
	return (
		<div className="flex flex-col gap-4" data-testid="jetbrains-signin-guidance">
			<p className="text-text-muted tr-text-metadata">{t("settings.jbcentral.signInGuidance")}</p>
			<SignInButton
				label={t("settings.jbcentral.signInToJetBrains")}
				signingIn={signingIn}
				onSignIn={onSignIn}
			/>
		</div>
	);
}

function SignedOutNotice() {
	const t = useT();
	return (
		<p
			className="flex items-start gap-4 text-feedback-warning tr-text-metadata"
			data-testid="jetbrains-signed-out"
		>
			<AlertTriangle className="mt-2 size-14 shrink-0" />
			{t("settings.jbcentral.signedOut")}
		</p>
	);
}

function isSignedOut(status: JbcentralStatus): boolean {
	return (status.state === "supported" || status.state === "configured") && status.signedOut;
}

function actionForStatus(status: JbcentralStatus): JbcentralAction | null {
	switch (status.state) {
		case "supported":
			return "connect";
		case "configured":
			return status.proxyStopped ? "start-proxy" : "disconnect";
		case "outdated":
			return "update";
		default:
			return null;
	}
}

function retryActionFor(
	status: Extract<JbcentralStatus, { state: "load-failed" }>,
): JbcentralAction {
	return status.configured ? "connect" : "disconnect";
}

function needsRecheck(status: JbcentralStatus): boolean {
	return status.state === "malformed-version" || status.state === "probe-failed";
}

const ACTION_LABEL = {
	connect: "settings.jbcentral.action.connect",
	disconnect: "settings.jbcentral.action.disconnect",
	"start-proxy": "settings.jbcentral.action.startProxy",
	update: "settings.jbcentral.action.update",
} satisfies Record<JbcentralAction, MessageKey>;

const ACTION_BUSY_LABEL = {
	connect: "settings.jbcentral.busy.connect",
	disconnect: "settings.jbcentral.busy.disconnect",
	"start-proxy": "settings.jbcentral.busy.startProxy",
	update: "settings.jbcentral.busy.update",
} satisfies Record<JbcentralAction, MessageKey>;

const ACTION_PROGRESS = {
	connect: "settings.jbcentral.progress.connect",
	disconnect: "settings.jbcentral.progress.disconnect",
	"start-proxy": "settings.jbcentral.progress.startProxy",
	update: "settings.jbcentral.progress.update",
} satisfies Record<JbcentralAction, MessageKey>;

const ACTION_FAILED = {
	connect: "settings.jbcentral.failure.connect",
	disconnect: "settings.jbcentral.failure.disconnect",
	"start-proxy": "settings.jbcentral.failure.startProxy",
	update: "settings.jbcentral.failure.update",
} satisfies Record<JbcentralAction, MessageKey>;

function failureText(action: JbcentralAction, reason: JbcentralActionFailureReason): MessageKey {
	switch (reason) {
		case "not-installed":
			return "settings.jbcentral.failure.notInstalled";
		case "unsupported-version":
			return "settings.jbcentral.failure.unsupportedVersion";
		case "version-probe-failed":
			return "settings.jbcentral.failure.versionProbeFailed";
		case "central-action-failed":
			return ACTION_FAILED[action];
		case "artifact-missing":
		case "artifact-present":
			return "settings.jbcentral.failure.unconfirmed";
		case "candidate-failed":
			return "settings.jbcentral.failure.candidateFailed";
	}
}

function CopyableCommand({ command }: { command: string }) {
	const t = useT();
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		if (!(await copyText(command))) return;
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};
	return (
		<div className="flex items-center gap-8 rounded-sm border border-border-default bg-container-workspace-bg px-8 py-4">
			<code className="min-w-0 flex-1 select-all break-all tr-code-text text-text-default">
				{command}
			</code>
			<button
				type="button"
				data-testid="jetbrains-copy-cmd"
				aria-label={t("settings.jbcentral.copyCommand", { command })}
				title={t("common.copy")}
				onClick={() => void copy()}
				className="flex size-24 shrink-0 items-center justify-center rounded-sm text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
			>
				{copied ? (
					<Check className="size-14 text-feedback-success" />
				) : (
					<Copy className="size-14" />
				)}
			</button>
		</div>
	);
}
