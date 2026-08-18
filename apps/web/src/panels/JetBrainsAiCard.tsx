import type {
	JbcentralAction,
	JbcentralActionFailureReason,
	JbcentralActionResult,
	JbcentralInstall,
	JbcentralStatus,
} from "@thinkrail/contracts";
import {
	AlertTriangle,
	Check,
	Copy,
	ExternalLink,
	Loader2,
	LogOut,
	RefreshCw,
	Wrench,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib";
import { getTransport } from "@/transport";

const LOGIN_CMD = "central login";

type Notice =
	| { kind: "blocked"; action: Exclude<JbcentralAction, "update">; sessionIds: string[] }
	| { kind: "failed"; action: JbcentralAction; reason: JbcentralActionFailureReason }
	| { kind: "transport-failed"; action: JbcentralAction }
	| { kind: "login-launched" }
	| { kind: "login-failed" };

/**
 * Guided native JetBrains AI configuration. The host's closed `JbcentralStatus` is the authority; local state
 * remembers only the initiating action and the closed result that a later status read cannot represent (for
 * example, a disconnect blocked by live sessions). No Central child output or extension data reaches here.
 */
export function JetBrainsAiCard({
	status,
	install,
	onChanged,
	onOpenChat,
}: {
	status: JbcentralStatus;
	install: JbcentralInstall;
	onChanged: () => void | Promise<void>;
	onOpenChat: (sessionId: string) => void | Promise<void>;
}) {
	const [busyAction, setBusyAction] = useState<JbcentralAction | null>(null);
	const [notice, setNotice] = useState<Notice | null>(null);
	const [signingIn, setSigningIn] = useState(false);

	// Pending reconciliation can finish after the initiating request has returned. Poll only while the host
	// says work remains; every poll still goes through the ordinary provider.status authority.
	useEffect(() => {
		if (status.state !== "pending" && status.state !== "configuring") return;
		const timer = setInterval(() => void onChanged(), 500);
		return () => clearInterval(timer);
	}, [status.state, onChanged]);

	// A completed host transition supersedes transient success/login guidance, but blocked/failure receipts
	// remain useful until the user retries an action.
	useEffect(() => {
		if (status.state === "configured") {
			setNotice((current) =>
				current?.kind === "login-launched" || current?.kind === "login-failed" ? null : current,
			);
		}
	}, [status.state]);

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
							: await getTransport().request("provider.jbcentralUpdate", {});
				if (result.outcome === "blocked") {
					setNotice(
						action === "update"
							? { kind: "failed", action, reason: "recovery-failed" }
							: { kind: "blocked", action, sessionIds: result.affectedSessionIds },
					);
				} else if (result.outcome === "failed") {
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
		} catch {
			setNotice({ kind: "login-failed" });
		} finally {
			setSigningIn(false);
		}
	}, [signingIn]);

	const visibleState = busyAction ? "configuring" : status.state;
	const installed = status.state !== "absent";
	const configured =
		status.state === "configured" || (status.state === "blocked" && status.action === "disconnect");
	const primaryAction = actionForStatus(status);
	const blockedSessionIds =
		notice?.kind === "blocked"
			? notice.sessionIds
			: status.state === "blocked"
				? status.affectedSessionIds
				: null;
	const blockedAction =
		notice?.kind === "blocked" ? notice.action : status.state === "blocked" ? status.action : null;

	return (
		<section
			data-testid="jetbrains-ai-card"
			data-state={visibleState}
			data-configured={configured}
			data-installed={installed}
			className="flex flex-col gap-sm rounded-[var(--radius-sm)] border border-border-default bg-control-bg p-md"
		>
			<div className="flex items-center gap-md">
				<span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-primary-subtle text-primary">
					<Zap className="size-4" />
				</span>
				<div className="flex min-w-0 flex-col">
					<span className="tr-text-ui text-text-default">JetBrains AI</span>
					<span className="text-text-muted tr-text-metadata">
						Use models made available through your JetBrains subscription.
					</span>
				</div>
				<div className="ml-auto shrink-0">
					{busyAction ? (
						<Button size="sm" disabled data-testid="jetbrains-configuring">
							<Loader2 className="size-3.5 animate-spin" />
							{actionLabel(busyAction)}…
						</Button>
					) : primaryAction ? (
						<ActionButton action={primaryAction} onAction={() => void runAction(primaryAction)} />
					) : needsRecheck(status) ? (
						<Button
							variant="ghost"
							size="sm"
							data-testid="jetbrains-recheck"
							onClick={() => void onChanged()}
						>
							<RefreshCw className="size-3.5" />
							Recheck
						</Button>
					) : null}
				</div>
			</div>

			<StatusBody status={status} install={install} onChanged={onChanged} />

			{blockedSessionIds ? (
				<div className="flex flex-col gap-xs" data-testid="jetbrains-model-blocked">
					<p className="flex items-start gap-xs text-feedback-warning tr-text-metadata">
						<AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
						{blockedAction ? actionLabel(blockedAction) : "This action"} is blocked because these
						chats use a model that would no longer be available. Choose another model or delete the
						chats, then retry.
					</p>
					<div className="flex flex-wrap gap-xs">
						{blockedSessionIds.map((sessionId, index) => (
							<Button
								key={sessionId}
								variant="outline"
								size="sm"
								data-testid="jetbrains-affected-chat"
								onClick={() => void onOpenChat(sessionId)}
							>
								Open affected chat {index + 1}
							</Button>
						))}
					</div>
				</div>
			) : null}

			{notice?.kind === "failed" || notice?.kind === "transport-failed" ? (
				<div className="flex flex-col gap-xs" data-testid="jetbrains-error">
					<p className="text-feedback-error tr-text-metadata">
						{notice.kind === "failed"
							? failureText(notice.action, notice.reason)
							: "ThinkRail couldn't reach the host. Recheck the connection and try again."}
					</p>
					{notice.action === "connect" &&
					(notice.kind === "transport-failed" || notice.reason === "central-action-failed") ? (
						<SignInGuidance signingIn={signingIn} onSignIn={() => void signIn()} />
					) : null}
				</div>
			) : null}

			{notice?.kind === "login-launched" ? (
				<p className="text-text-muted tr-text-metadata" data-testid="jetbrains-login-launched">
					Complete sign-in in the browser, then Connect again.
				</p>
			) : notice?.kind === "login-failed" ? (
				<div className="flex flex-col gap-xs" data-testid="jetbrains-login-failed">
					<p className="text-feedback-error tr-text-metadata">
						ThinkRail couldn't launch Central sign-in. Run this on the host instead:
					</p>
					<CopyableCommand command={LOGIN_CMD} />
				</div>
			) : null}
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
				<LogOut className="size-3.5" />
			) : action === "update" ? (
				<Wrench className="size-3.5" />
			) : (
				<Zap className="size-3.5" />
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
	switch (status.state) {
		case "absent":
			return (
				<div className="flex flex-col gap-xs" data-testid="jetbrains-needs-install">
					<p className="text-text-muted tr-text-metadata">
						PI is included with ThinkRail. Install only the JetBrains Central CLI on the host, then
						Recheck.
					</p>
					<CopyableCommand command={install.command} />
					<Button
						variant="ghost"
						size="sm"
						data-testid="jetbrains-recheck"
						onClick={() => void onChanged()}
						className="self-start"
					>
						<RefreshCw className="size-3.5" />
						Recheck
					</Button>
				</div>
			);
		case "outdated":
			return (
				<p className="text-feedback-warning tr-text-metadata" data-testid="jetbrains-outdated">
					Central {status.version} is older than the reviewed version. Update it before connecting.
				</p>
			);
		case "supported":
			return (
				<p className="text-text-muted tr-text-metadata" data-testid="jetbrains-ready">
					Central is ready. Connect to make its JetBrains AI models available to ThinkRail.
				</p>
			);
		case "configured":
			return (
				<p
					className="flex items-center gap-xs text-feedback-success tr-text-metadata"
					data-testid="jetbrains-connected"
				>
					<Check className="size-3.5 shrink-0" />
					Connected — Central's JetBrains AI models are available to ThinkRail.
				</p>
			);
		case "unreviewed":
			return (
				<p className="text-feedback-warning tr-text-metadata" data-testid="jetbrains-unreviewed">
					Central {status.version} is newer than the version reviewed with ThinkRail. Update
					ThinkRail or Recheck later before connecting.
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
				<p className="flex items-center gap-xs text-text-muted tr-text-metadata">
					<Loader2 className="size-3.5 animate-spin" />
					Central is {actionProgress(status.action)}. Keep ThinkRail open.
				</p>
			);
		case "pending":
			return (
				<p
					className="flex items-center gap-xs text-text-muted tr-text-metadata"
					data-testid="jetbrains-pending"
				>
					<Loader2 className="size-3.5 animate-spin" />
					Waiting for accepted agent work to settle, then{" "}
					{status.action === "connect" ? "connecting" : "disconnecting"}.
				</p>
			);
		case "blocked":
			// The detailed status, affected-session links, and retry action render at card level.
			return null;
		case "recovery-required":
			return (
				<p
					className="flex items-start gap-xs text-feedback-error tr-text-metadata"
					data-testid="jetbrains-recovery-required"
				>
					<AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
					Central configuration needs repair before model actions can resume. Retry the action.
				</p>
			);
	}
}

function SignInGuidance({ signingIn, onSignIn }: { signingIn: boolean; onSignIn: () => void }) {
	return (
		<div className="flex flex-col gap-xs" data-testid="jetbrains-signin-guidance">
			<p className="text-text-muted tr-text-metadata">
				If Central needs authentication, sign in and then retry Connect. You can also run this on
				the host:
			</p>
			<CopyableCommand command={LOGIN_CMD} />
			<Button
				variant="outline"
				size="sm"
				data-testid="jetbrains-signin"
				disabled={signingIn}
				onClick={onSignIn}
				className="self-start"
			>
				{signingIn ? (
					<Loader2 className="size-3.5 animate-spin" />
				) : (
					<ExternalLink className="size-3.5" />
				)}
				Sign in to JetBrains
			</Button>
		</div>
	);
}

function actionForStatus(status: JbcentralStatus): JbcentralAction | null {
	switch (status.state) {
		case "supported":
			return "connect";
		case "configured":
			return "disconnect";
		case "outdated":
			return "update";
		case "blocked":
		case "recovery-required":
			return status.action;
		default:
			return null;
	}
}

function needsRecheck(status: JbcentralStatus): boolean {
	return (
		status.state === "unreviewed" ||
		status.state === "malformed-version" ||
		status.state === "probe-failed"
	);
}

function actionLabel(action: JbcentralAction): string {
	return action === "connect" ? "Connect" : action === "disconnect" ? "Disconnect" : "Update";
}

function actionProgress(action: JbcentralAction): string {
	return action === "connect"
		? "connecting"
		: action === "disconnect"
			? "disconnecting"
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
			return `Central couldn't ${action}. Check Central on the host and try again.`;
		case "artifact-missing":
		case "artifact-present":
			return "Central finished, but ThinkRail couldn't confirm the configuration. Recheck and retry.";
		case "legacy-cleanup-invalid":
		case "legacy-cleanup-failed":
		case "legacy-cleanup-conflict":
			return "ThinkRail couldn't safely migrate an earlier configuration. Review the host configuration and retry.";
		case "candidate-failed":
			return "ThinkRail couldn't prepare the updated model runtime. The previous runtime was retained.";
		case "reattach-failed":
			return "ThinkRail couldn't preserve every live chat in the updated runtime. Change models or delete the affected chats and retry.";
		case "recovery-failed":
			return "Automatic recovery didn't complete. Retry the action before using model features.";
	}
}

/** A copyable one-line shell command (mono, with a copy affordance). */
function CopyableCommand({ command }: { command: string }) {
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		if (!(await copyText(command))) return;
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};
	return (
		<div className="flex items-center gap-sm rounded-[var(--radius-sm)] border border-border-default bg-container-workspace-bg px-sm py-xs">
			<code className="min-w-0 flex-1 select-all break-all tr-code-text text-text-default">
				{command}
			</code>
			<button
				type="button"
				data-testid="jetbrains-copy-cmd"
				aria-label={`Copy: ${command}`}
				title="Copy"
				onClick={() => void copy()}
				className="flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
			>
				{copied ? (
					<Check className="size-3.5 text-feedback-success" />
				) : (
					<Copy className="size-3.5" />
				)}
			</button>
		</div>
	);
}
