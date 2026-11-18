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
	JBCENTRAL_QUOTA_REFRESH_SECONDS,
	type JbcentralAction,
	type JbcentralActionFailureReason,
	type JbcentralActionResult,
	type JbcentralInstall,
	type JbcentralStatus,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton, withIconClass } from "@thinkrail/ui/button";
import { Switch } from "@thinkrail/ui/switch";
import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "@/lib";
import { SettingsGroup, SettingsNumberField, type SettingsReset, SettingsRow } from "@/settingsKit";
import { getTransport } from "@/transport";
import { SETTING, settingProps } from "./settingsCatalog";

const LOGIN_CMD = "central login";

type Notice =
	| { kind: "failed"; action: JbcentralAction; reason: JbcentralActionFailureReason }
	| { kind: "transport-failed"; action: JbcentralAction }
	| { kind: "login-launched" }
	| { kind: "login-failed" };

interface Marks {
	readonly tabIndex?: number;
	readonly "data-setting-stop"?: "";
	readonly "data-setting-side"?: "";
}

const NO_MARKS: Marks = {};
const STOP_MARKS: Marks = { tabIndex: 0, "data-setting-stop": "" };
const SIDE_MARKS: Marks = { tabIndex: 0, "data-setting-side": "" };

function useJetBrainsCentral(status: JbcentralStatus, onChanged: () => void | Promise<void>) {
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

	return {
		status,
		onChanged,
		busyAction,
		notice,
		signingIn,
		runAction,
		signIn,
		visibleState: busyAction ? "configuring" : status.state,
		signedOut: isSignedOut(status),
		installed: status.state !== "absent",
		configured: status.state === "configured",
	};
}

type Central = ReturnType<typeof useJetBrainsCentral>;

function CentralActions({
	central,
	first = NO_MARKS,
	rest = NO_MARKS,
	recheckWhenAbsent = false,
}: {
	central: Central;
	first?: Marks;
	rest?: Marks;
	recheckWhenAbsent?: boolean;
}) {
	const t = useT();
	const { status, busyAction, signedOut, signingIn, runAction, signIn, onChanged } = central;
	const primaryAction = actionForStatus(status);
	const retryAction = status.state === "load-failed" ? retryActionFor(status) : null;
	if (busyAction) {
		return (
			<Button
				variant="primary"
				size="m"
				iconLeft={Loader2}
				loading
				data-testid="jetbrains-configuring"
				{...first}
			>
				{t(ACTION_BUSY_LABEL[busyAction])}
			</Button>
		);
	}
	if (signedOut) {
		return (
			<SignInButton
				label={t("settings.jbcentral.signIn")}
				signingIn={signingIn}
				marks={first}
				onSignIn={() => void signIn()}
			/>
		);
	}
	if (status.state === "load-failed" && retryAction) {
		return (
			<>
				<Button
					variant="primary"
					size="m"
					iconLeft={RefreshCw}
					data-testid="jetbrains-retry"
					{...first}
					onClick={() => void runAction(retryAction)}
				>
					{t("common.retry")}
				</Button>
				{status.configured ? (
					<ActionButton
						action="disconnect"
						marks={rest}
						onAction={() => void runAction("disconnect")}
					/>
				) : null}
			</>
		);
	}
	if (primaryAction) {
		return (
			<ActionButton
				action={primaryAction}
				marks={first}
				onAction={() => void runAction(primaryAction)}
			/>
		);
	}
	if (needsRecheck(status) || (recheckWhenAbsent && status.state === "absent")) {
		return <RecheckButton marks={first} onChanged={onChanged} />;
	}
	return null;
}

function CentralNotices({ central, marks = NO_MARKS }: { central: Central; marks?: Marks }) {
	const t = useT();
	const { notice, signedOut, signingIn, signIn } = central;
	return (
		<>
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
						<SignInGuidance signingIn={signingIn} marks={marks} onSignIn={() => void signIn()} />
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
					<CopyableCommand command={LOGIN_CMD} marks={marks} />
				</div>
			) : null}
		</>
	);
}

export function JetBrainsAiCard({
	status,
	install,
	onChanged,
}: {
	status: JbcentralStatus;
	install: JbcentralInstall;
	onChanged: () => void | Promise<void>;
}) {
	const t = useT();
	const central = useJetBrainsCentral(status, onChanged);
	return (
		<section
			data-testid="jetbrains-ai-card"
			data-state={central.visibleState}
			data-configured={central.configured}
			data-installed={central.installed}
			className="flex flex-col gap-8"
		>
			<div className="flex items-center justify-between gap-12">
				<h3 className="tr-text-label-pill text-text-subtle">{t("settings.jbcentral.title")}</h3>
				<div className="flex shrink-0 items-center gap-4">
					<CentralActions central={central} />
				</div>
			</div>

			<StatusBody status={status} install={install} onChanged={onChanged} />

			<CentralNotices central={central} />
		</section>
	);
}

export interface JetBrainsQuotaSettings {
	enabled: boolean;
	refreshSeconds: number;
	enabledReset: SettingsReset;
	intervalReset: SettingsReset;
	onEnabledChange: (enabled: boolean) => void;
	onRefreshSecondsChange: (seconds: number) => Promise<boolean>;
}

export function JetBrainsAiSettings({
	status,
	install,
	onChanged,
	quota,
}: {
	status: JbcentralStatus;
	install: JbcentralInstall;
	onChanged: () => void | Promise<void>;
	quota: JetBrainsQuotaSettings | null;
}) {
	const t = useT();
	const central = useJetBrainsCentral(status, onChanged);
	const quotaRow = settingProps(t, SETTING.jetbrainsQuota);
	const intervalRow = settingProps(t, SETTING.jetbrainsQuotaInterval);
	return (
		<SettingsGroup
			title={t("settings.jbcentral.title")}
			description={t("settings.jbcentral.description")}
			testId="settings-jetbrains"
		>
			<div
				data-setting-row={SETTING.jetbrainsCentral.id}
				data-setting-id={SETTING.jetbrainsCentral.id}
				data-testid="jetbrains-ai-card"
				data-state={central.visibleState}
				data-configured={central.configured}
				data-installed={central.installed}
				className="border-border-muted border-b py-12"
			>
				<div className="flex flex-col gap-8 rounded-sm bg-control-bg px-12 py-8">
					<div className="flex flex-wrap items-start justify-between gap-12">
						<div className="flex min-w-160 flex-1 flex-col gap-4">
							<span className="tr-text-emphasis text-text-default">
								{t("settings.jbcentral.central")}
							</span>
							<StatusBody
								status={status}
								install={install}
								onChanged={onChanged}
								marks={SIDE_MARKS}
								recheck={false}
							/>
						</div>
						<div className="flex shrink-0 flex-wrap items-center gap-4">
							<CentralActions
								central={central}
								first={STOP_MARKS}
								rest={SIDE_MARKS}
								recheckWhenAbsent
							/>
						</div>
					</div>
					<CentralNotices central={central} marks={SIDE_MARKS} />
				</div>
			</div>
			{quota ? (
				<>
					<SettingsRow
						{...quotaRow}
						testId="jbcentral-quota-settings"
						control={
							<Switch
								checked={quota.enabled}
								label={t("settings.jbcentral.quota.showLabel")}
								testId="jbcentral-quota-toggle"
								tabIndex={0}
								onCheckedChange={quota.onEnabledChange}
							/>
						}
						reset={quota.enabledReset}
					/>
					<SettingsRow
						{...intervalRow}
						description={t("settings.jbcentral.quota.intervalDescription", {
							min: JBCENTRAL_QUOTA_REFRESH_SECONDS.min,
							max: JBCENTRAL_QUOTA_REFRESH_SECONDS.max,
						})}
						control={
							<SettingsNumberField
								label={intervalRow.label}
								value={quota.refreshSeconds}
								min={JBCENTRAL_QUOTA_REFRESH_SECONDS.min}
								max={JBCENTRAL_QUOTA_REFRESH_SECONDS.max}
								unit={t("settings.jbcentral.quota.seconds")}
								disabled={!quota.enabled}
								testId="jbcentral-quota-interval"
								onCommit={quota.onRefreshSecondsChange}
							/>
						}
						reset={quota.intervalReset}
					/>
				</>
			) : null}
		</SettingsGroup>
	);
}

function RecheckButton({
	marks,
	onChanged,
	className,
}: {
	marks: Marks;
	onChanged: () => void | Promise<void>;
	className?: string;
}) {
	const t = useT();
	return (
		<Button
			variant="ghost"
			size="m"
			iconLeft={RefreshCw}
			data-testid="jetbrains-recheck"
			{...marks}
			onClick={() => void onChanged()}
			className={className}
		>
			{t("settings.jbcentral.recheck")}
		</Button>
	);
}

function ActionButton({
	action,
	marks,
	onAction,
}: {
	action: JbcentralAction;
	marks: Marks;
	onAction: () => void;
}) {
	const t = useT();
	const disconnect = action === "disconnect";
	const icon = disconnect
		? LogOut
		: action === "update"
			? Wrench
			: action === "start-proxy"
				? Play
				: null;
	return (
		<Button
			variant={disconnect ? "outline" : "primary"}
			size="m"
			{...(icon ? { iconLeft: icon } : {})}
			data-testid={`jetbrains-${action}`}
			{...marks}
			onClick={onAction}
		>
			{t(ACTION_LABEL[action])}
		</Button>
	);
}

function StatusBody({
	status,
	install,
	onChanged,
	marks = NO_MARKS,
	recheck = true,
}: {
	status: JbcentralStatus;
	install: JbcentralInstall;
	onChanged: () => void | Promise<void>;
	marks?: Marks;
	recheck?: boolean;
}) {
	const t = useT();
	if (isSignedOut(status)) return <SignedOutNotice />;

	switch (status.state) {
		case "absent":
			return (
				<div className="flex flex-col gap-4" data-testid="jetbrains-needs-install">
					<p className="text-text-muted tr-text-metadata">{t("settings.jbcentral.needsInstall")}</p>
					<CopyableCommand command={install.command} marks={marks} />
					{recheck ? (
						<RecheckButton marks={marks} onChanged={onChanged} className="self-start" />
					) : null}
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
	marks,
}: {
	signingIn: boolean;
	onSignIn: () => void;
	label: string;
	marks: Marks;
}) {
	return (
		<Button
			variant="soft-primary"
			size="m"
			iconLeft={ExternalLink}
			loading={signingIn}
			data-testid="jetbrains-signin"
			{...marks}
			onClick={onSignIn}
			className="self-start"
		>
			{label}
		</Button>
	);
}

function SignInGuidance({
	signingIn,
	onSignIn,
	marks,
}: {
	signingIn: boolean;
	onSignIn: () => void;
	marks: Marks;
}) {
	const t = useT();
	return (
		<div className="flex flex-col gap-4" data-testid="jetbrains-signin-guidance">
			<p className="text-text-muted tr-text-metadata">{t("settings.jbcentral.signInGuidance")}</p>
			<SignInButton
				label={t("settings.jbcentral.signInToJetBrains")}
				signingIn={signingIn}
				marks={marks}
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

const CopiedCheck = withIconClass(Check, "text-feedback-success");

function CopyableCommand({ command, marks }: { command: string; marks: Marks }) {
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
			<IconButton
				icon={copied ? CopiedCheck : Copy}
				label={t("settings.jbcentral.copyCommand", { command })}
				tooltip={t("common.copy")}
				data-testid="jetbrains-copy-cmd"
				{...marks}
				onClick={() => void copy()}
				className="shrink-0"
			/>
		</div>
	);
}
