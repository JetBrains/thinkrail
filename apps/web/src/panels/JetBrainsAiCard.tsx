import {
	RiAlertLine as AlertTriangle,
	RiCheckLine as Check,
	RiFileCopyLine as Copy,
	RiExternalLinkLine as ExternalLink,
	RiLoader4Line as Loader2,
	RiLogoutBoxLine as LogOut,
	RiPlayLine as Play,
	RiRefreshLine as RefreshCw,
	RiBardLine,
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
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib";
import { getTransport } from "@/transport";
import { SettingsSwitch } from "./SettingsSwitch";

const LOGIN_CMD = "central login";
const QUOTA_INTERVAL_RANGE = `${JBCENTRAL_QUOTA_REFRESH_SECONDS.min}–${JBCENTRAL_QUOTA_REFRESH_SECONDS.max}`;

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
	const [draft, setDraft] = useState(String(refreshSeconds));
	const [error, setError] = useState<string | null>(null);

	useEffect(() => setDraft(String(refreshSeconds)), [refreshSeconds]);

	const saveInterval = async () => {
		const seconds = Number(draft);
		if (!isJbcentralQuotaRefreshSeconds(seconds)) {
			setError(
				`Enter a whole number from ${JBCENTRAL_QUOTA_REFRESH_SECONDS.min} to ${JBCENTRAL_QUOTA_REFRESH_SECONDS.max}.`,
			);
			return;
		}
		if (seconds === refreshSeconds) {
			setError(null);
			return;
		}
		try {
			await onRefreshSecondsChange(seconds);
			setError(null);
		} catch {
			setDraft(String(refreshSeconds));
			setError("Couldn't save the refresh interval.");
		}
	};

	return (
		<div
			data-testid="jbcentral-quota-settings"
			className="flex flex-col gap-8 border-border-muted border-t pt-12"
		>
			<div className="flex items-center justify-between gap-12">
				<div className="min-w-0">
					<p className="text-text-default tr-text-ui">Show quota in top bar</p>
					<p className="text-text-muted tr-text-metadata">
						Display recurring JetBrains AI credits while Central is connected.
					</p>
				</div>
				<SettingsSwitch
					checked={enabled}
					label="Show JetBrains AI quota in top bar"
					testId="jbcentral-quota-toggle"
					onChange={(next) => {
						setError(null);
						void onEnabledChange(next).catch(() =>
							setError("Couldn't save the quota display setting."),
						);
					}}
				/>
			</div>
			<div className="flex items-center gap-8">
				<label htmlFor="jbcentral-quota-interval" className="text-text-muted tr-text-metadata">
					Refresh every
				</label>
				<input
					id="jbcentral-quota-interval"
					type="number"
					data-testid="jbcentral-quota-interval"
					min={JBCENTRAL_QUOTA_REFRESH_SECONDS.min}
					max={JBCENTRAL_QUOTA_REFRESH_SECONDS.max}
					step={1}
					value={draft}
					disabled={!enabled}
					aria-invalid={error ? true : undefined}
					onChange={(event) => {
						setDraft(event.currentTarget.value);
						setError(null);
					}}
					onBlur={() => void saveInterval()}
					onKeyDown={(event) => {
						if (event.key === "Enter") event.currentTarget.blur();
					}}
					className="w-80 rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-8 py-4 text-text-default tr-text-ui outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text"
				/>
				<span className="text-text-muted tr-text-metadata">seconds</span>
				<span className="ml-auto text-text-subtle tr-text-metadata">{QUOTA_INTERVAL_RANGE}</span>
			</div>
			{error ? (
				<p
					data-testid="jbcentral-quota-interval-error"
					className="text-feedback-error tr-text-metadata"
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
			try {
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
			} catch {
				setNotice({ kind: "transport-failed", action });
			} finally {
				setBusyAction(null);
			}
		},
		[onChanged],
	);

	const signIn = useCallback(async () => {
		if (signingIn) return;
		setSigningIn(true);
		try {
			const result = await getTransport().request("provider.jbcentralLogin", {});
			setNotice(
				result.outcome === "launched" ? { kind: "login-launched" } : { kind: "login-failed" },
			);
			if (result.outcome === "launched") await onChanged();
		} catch {
			setNotice({ kind: "login-failed" });
		} finally {
			setSigningIn(false);
		}
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
			className="flex flex-col gap-8 rounded-[var(--radius-sm)] border border-border-default bg-control-bg p-12"
		>
			<div className="flex items-center gap-12">
				<span className="flex size-32 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-primary-subtle text-primary">
					<RiBardLine className="size-16" />
				</span>
				<div className="flex min-w-0 flex-col">
					<span className="tr-text-ui text-text-default">JetBrains AI</span>
					<span className="text-text-muted tr-text-metadata">
						Use models made available through your JetBrains subscription.
					</span>
				</div>
				<div className="ml-auto flex shrink-0 items-center gap-4">
					{busyAction ? (
						<Button size="sm" disabled data-testid="jetbrains-configuring">
							<Loader2 className="size-14 animate-spin" />
							{actionLabel(busyAction)}…
						</Button>
					) : signedOut ? (
						<SignInButton
							variant="default"
							label="Sign in"
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
								Retry
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
							Recheck
						</Button>
					) : null}
				</div>
			</div>

			<StatusBody status={status} install={install} onChanged={onChanged} />

			{notice?.kind === "failed" || notice?.kind === "transport-failed" ? (
				<div className="flex flex-col gap-4" data-testid="jetbrains-error">
					<p className="text-feedback-error tr-text-metadata">
						{notice.kind === "failed"
							? failureText(notice.action, notice.reason)
							: "ThinkRail couldn't reach the host. Recheck the connection and try again."}
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
					Complete sign-in in the browser on the host, then Refresh.
				</p>
			) : notice?.kind === "login-failed" ? (
				<div className="flex flex-col gap-4" data-testid="jetbrains-login-failed">
					<p className="text-feedback-error tr-text-metadata">
						ThinkRail couldn't launch Central sign-in. Run this on the host instead:
					</p>
					<CopyableCommand command={LOGIN_CMD} />
				</div>
			) : null}

			{quotaSettings ? <JbcentralQuotaSettings {...quotaSettings} /> : null}
		</section>
	);
}

function ActionButton({ action, onAction }: { action: JbcentralAction; onAction: () => void }) {
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
			) : (
				<RiBardLine className="size-14" />
			)}
			{actionLabel(action)}
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
	if (isSignedOut(status)) return <SignedOutNotice />;

	switch (status.state) {
		case "absent":
			return (
				<div className="flex flex-col gap-4" data-testid="jetbrains-needs-install">
					<p className="text-text-muted tr-text-metadata">
						Install the JetBrains Central CLI (central), then Recheck:
					</p>
					<CopyableCommand command={install.command} />
					<Button
						variant="ghost"
						size="sm"
						data-testid="jetbrains-recheck"
						onClick={() => void onChanged()}
						className="self-start"
					>
						<RefreshCw className="size-14" />
						Recheck
					</Button>
				</div>
			);
		case "outdated":
			return (
				<p className="text-feedback-warning tr-text-metadata" data-testid="jetbrains-outdated">
					Central {status.version} is older than the minimum ThinkRail supports. Update it before
					connecting.
				</p>
			);
		case "supported":
			return (
				<p className="text-text-muted tr-text-metadata" data-testid="jetbrains-ready">
					Central is ready. Connect to make its JetBrains AI models available to new chats.
				</p>
			);
		case "configured":
			return status.proxyStopped ? (
				<p
					className="flex items-start gap-4 text-feedback-warning tr-text-metadata"
					data-testid="jetbrains-proxy-stopped"
				>
					<AlertTriangle className="mt-2 size-14 shrink-0" />
					Central's proxy is not running. Start it to use JetBrains AI models.
				</p>
			) : (
				<p
					className="flex items-center gap-4 text-feedback-success tr-text-metadata"
					data-testid="jetbrains-connected"
				>
					<Check className="size-14 shrink-0" />
					Connected — Central's JetBrains AI models are available to new chats.
				</p>
			);
		case "malformed-version":
			return (
				<p className="text-feedback-error tr-text-metadata" data-testid="jetbrains-version-error">
					ThinkRail couldn't verify this Central version safely. Reinstall Central, then Recheck.
				</p>
			);
		case "probe-failed":
			return (
				<p className="text-feedback-error tr-text-metadata" data-testid="jetbrains-version-error">
					ThinkRail couldn't verify Central right now. Check the host installation, then Recheck.
				</p>
			);
		case "configuring":
			return (
				<p className="flex items-center gap-4 text-text-muted tr-text-metadata">
					<Loader2 className="size-14 animate-spin" />
					{status.action
						? `Central is ${actionProgress(status.action)}. Keep ThinkRail open.`
						: "ThinkRail is applying the latest Central configuration."}
				</p>
			);
		case "load-failed":
			return (
				<p
					className="flex items-start gap-4 text-feedback-error tr-text-metadata"
					data-testid="jetbrains-load-failed"
				>
					<AlertTriangle className="mt-2 size-14 shrink-0" />
					ThinkRail couldn't prepare the updated model runtime. The previous runtime remains
					available; retry, or disconnect Central to rebuild without it.
				</p>
			);
	}
}

function SignInButton({
	signingIn,
	onSignIn,
	label,
	variant,
}: {
	signingIn: boolean;
	onSignIn: () => void;
	label: string;
	variant: "default" | "outline";
}) {
	return (
		<Button
			variant={variant}
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
	return (
		<div className="flex flex-col gap-4" data-testid="jetbrains-signin-guidance">
			<p className="text-text-muted tr-text-metadata">
				If Central needs authentication, sign in and then retry Connect.
			</p>
			<SignInButton
				variant="outline"
				label="Sign in to JetBrains"
				signingIn={signingIn}
				onSignIn={onSignIn}
			/>
		</div>
	);
}

function SignedOutNotice() {
	return (
		<p
			className="flex items-start gap-4 text-feedback-warning tr-text-metadata"
			data-testid="jetbrains-signed-out"
		>
			<AlertTriangle className="mt-2 size-14 shrink-0" />
			Central is signed out. Sign in to use its JetBrains AI models.
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

function actionLabel(action: JbcentralAction): string {
	return action === "connect"
		? "Connect"
		: action === "disconnect"
			? "Disconnect"
			: action === "start-proxy"
				? "Start proxy"
				: "Update";
}

function actionProgress(action: JbcentralAction): string {
	return action === "connect"
		? "connecting"
		: action === "disconnect"
			? "disconnecting"
			: action === "start-proxy"
				? "starting the proxy"
				: "updating";
}

function failureText(action: JbcentralAction, reason: JbcentralActionFailureReason): string {
	switch (reason) {
		case "not-installed":
			return "Central isn't available on the host yet. Install it and Recheck.";
		case "unsupported-version":
			return "This Central version isn't supported by ThinkRail. Follow the version guidance and retry.";
		case "version-probe-failed":
			return "ThinkRail couldn't verify Central safely. Check the host installation and Recheck.";
		case "central-action-failed":
			return action === "start-proxy"
				? "Central couldn't start the proxy. Check Central on the host and try again."
				: `Central couldn't ${action}. Check Central on the host and try again.`;
		case "artifact-missing":
		case "artifact-present":
			return "Central finished, but ThinkRail couldn't confirm the configuration. Recheck and retry.";
		case "candidate-failed":
			return "ThinkRail couldn't prepare the updated model runtime. The previous runtime was retained.";
	}
}

function CopyableCommand({ command }: { command: string }) {
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		if (!(await copyText(command))) return;
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};
	return (
		<div className="flex items-center gap-8 rounded-[var(--radius-sm)] border border-border-default bg-container-workspace-bg px-8 py-4">
			<code className="min-w-0 flex-1 select-all break-all tr-code-text text-text-default">
				{command}
			</code>
			<button
				type="button"
				data-testid="jetbrains-copy-cmd"
				aria-label={`Copy: ${command}`}
				title="Copy"
				onClick={() => void copy()}
				className="flex size-24 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
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
