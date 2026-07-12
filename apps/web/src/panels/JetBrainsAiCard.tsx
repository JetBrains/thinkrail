import { Check, Copy, ExternalLink, Loader2, LogOut, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getTransport } from "@/transport";

// Mirrors the host's per-OS install hint (`@thinkrail/shared/jbcentral`'s `jbcentralInstallHint`) — shown
// proactively for the not-installed (mac/linux) case so users don't have to click to discover the command.
const INSTALL_CMD =
	"curl -fsSL https://jetbrains-central-cli.s3.eu-west-1.amazonaws.com/jbcentral/stable/install.sh | bash";
const LOGIN_CMD = "central login";

type Phase = "idle" | "needs-login" | "needs-install" | "error";

/**
 * The JetBrains AI option in the Providers settings: route Claude + GPT through the local `jbcentral` proxy
 * using your JetBrains subscription. A small state machine over the host's jbcentral CLI —
 * connected (Disconnect) / ready (Connect) / not signed in (in-app `jbcentral login` + retry) / not installed
 * (install guidance + Recheck). `wired`/`installed` come from the `provider.status` the pane already fetched;
 * `onChanged` re-reads it after a mutation.
 */
export function JetBrainsAiCard({
	wired,
	installed,
	onChanged,
}: {
	wired: boolean;
	installed: boolean;
	onChanged: () => void | Promise<void>;
}) {
	const [phase, setPhase] = useState<Phase>("idle");
	const [installHint, setInstallHint] = useState("");
	const [errorMsg, setErrorMsg] = useState("");
	const [busy, setBusy] = useState(false);
	const [signingIn, setSigningIn] = useState(false);
	const [loginLaunched, setLoginLaunched] = useState(false);

	// Reconcile stale local phase with freshly-fetched props (a re-read after Recheck, an external
	// `jbcentral login`/wire in a terminal, etc.): once wired, drop all transient state; once installed,
	// leave the needs-install screen. Functional updates read the latest phase, so `phase` isn't a dep.
	useEffect(() => {
		if (wired) {
			setPhase("idle");
			setLoginLaunched(false);
			setErrorMsg("");
		} else if (installed) {
			setPhase((p) => (p === "needs-install" ? "idle" : p));
		}
	}, [wired, installed]);

	const connect = useCallback(async () => {
		setBusy(true);
		try {
			const r = await getTransport().request("provider.jbcentralConnect", {});
			if (r.outcome === "connected") {
				setLoginLaunched(false);
				setErrorMsg("");
				setPhase("idle");
				await onChanged();
			} else if (r.outcome === "needs-install") {
				setInstallHint(r.hint ?? "");
				setPhase("needs-install");
			} else if (r.outcome === "needs-login") {
				setPhase("needs-login");
			} else {
				setErrorMsg(r.message || "Couldn't connect to JetBrains AI.");
				setPhase("error");
			}
		} catch {
			setErrorMsg("Couldn't reach the host.");
			setPhase("error");
		} finally {
			setBusy(false);
		}
	}, [onChanged]);

	const disconnect = useCallback(async () => {
		setBusy(true);
		try {
			await getTransport().request("provider.jbcentralDisconnect", {});
			setPhase("idle");
			setErrorMsg("");
			setLoginLaunched(false);
			await onChanged();
		} finally {
			setBusy(false);
		}
	}, [onChanged]);

	// Gate concurrent spawns — without this, rapid clicks launch multiple `jbcentral login` processes.
	const signIn = useCallback(async () => {
		if (signingIn) return;
		setSigningIn(true);
		try {
			const r = await getTransport().request("provider.jbcentralLogin", {});
			setLoginLaunched(r.launched);
		} catch {
			setLoginLaunched(false);
		} finally {
			setSigningIn(false);
		}
	}, [signingIn]);

	// The not-installed state is known up front from status (no click needed); a failed connect can also
	// surface it (with the host's exact hint).
	const showInstall = !wired && (phase === "needs-install" || !installed);

	return (
		<section
			data-testid="jetbrains-ai-card"
			data-wired={wired}
			data-installed={installed}
			className="flex flex-col gap-sm rounded-[var(--radius-lg)] border border-border2 bg-[var(--input-bg)] p-md"
		>
			<div className="flex items-center gap-md">
				<span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--primary-10)] text-primary">
					<Zap className="size-4" />
				</span>
				<div className="flex min-w-0 flex-col">
					<span className="font-medium text-sm text-text">JetBrains AI</span>
					<span className="truncate text-hint text-xs">
						Route Claude + GPT through your JetBrains subscription.
					</span>
				</div>
				<div className="ml-auto shrink-0">
					{wired ? (
						<Button
							variant="outline"
							size="sm"
							data-testid="jetbrains-disconnect"
							disabled={busy}
							onClick={() => void disconnect()}
						>
							<LogOut className="size-3.5" />
							Disconnect
						</Button>
					) : !showInstall ? (
						<Button
							size="sm"
							data-testid="jetbrains-connect"
							disabled={busy}
							onClick={() => void connect()}
						>
							{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
							Connect
						</Button>
					) : null}
				</div>
			</div>

			{wired ? (
				<p
					className="flex items-center gap-xs text-green text-xs"
					data-testid="jetbrains-connected"
				>
					<Check className="size-3.5 shrink-0" />
					Connected — Claude and GPT route through JetBrains AI.
				</p>
			) : null}

			{showInstall ? (
				<div className="flex flex-col gap-xs" data-testid="jetbrains-needs-install">
					<p className="text-hint text-xs">
						{installHint.includes("Windows")
							? "Install the JetBrains Central CLI for Windows, then Recheck."
							: "Install the JetBrains Central CLI (jbcentral), then Recheck:"}
					</p>
					{!installHint.includes("Windows") ? <CopyableCommand command={INSTALL_CMD} /> : null}
					<Button
						variant="ghost"
						size="sm"
						data-testid="jetbrains-recheck"
						disabled={busy}
						onClick={() => void onChanged()}
						className="self-start"
					>
						Recheck
					</Button>
				</div>
			) : null}

			{!wired && phase === "needs-login" ? (
				<div className="flex flex-col gap-xs" data-testid="jetbrains-needs-login">
					<p className="text-hint text-xs">
						{loginLaunched
							? "Complete sign-in in your browser, then Connect. If nothing opened, run this in a terminal:"
							: "Sign in to JetBrains AI, then Connect. You can also run this in a terminal:"}
					</p>
					<CopyableCommand command={LOGIN_CMD} />
					<div className="flex gap-sm">
						<Button
							variant="outline"
							size="sm"
							data-testid="jetbrains-signin"
							disabled={signingIn}
							onClick={() => void signIn()}
						>
							{signingIn ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : (
								<ExternalLink className="size-3.5" />
							)}
							Sign in to JetBrains
						</Button>
						<Button
							size="sm"
							data-testid="jetbrains-connect-retry"
							disabled={busy}
							onClick={() => void connect()}
						>
							{busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
							Connect
						</Button>
					</div>
				</div>
			) : null}

			{!wired && phase === "error" ? (
				<div className="flex flex-col gap-xs" data-testid="jetbrains-error">
					<p className="break-words text-red text-xs">{errorMsg}</p>
					<Button
						variant="ghost"
						size="sm"
						data-testid="jetbrains-retry"
						disabled={busy}
						onClick={() => void connect()}
						className="self-start"
					>
						Try again
					</Button>
				</div>
			) : null}
		</section>
	);
}

/** A copyable one-line shell command (mono, with a copy affordance). */
function CopyableCommand({ command }: { command: string }) {
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(command);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard unavailable — the command stays selectable text.
		}
	};
	return (
		<div className="flex items-center gap-sm rounded-[var(--radius-md)] border border-border2 bg-bg px-sm py-xs">
			<code className="min-w-0 flex-1 select-all break-all font-[var(--font-mono)] text-text text-xs">
				{command}
			</code>
			<button
				type="button"
				data-testid="jetbrains-copy-cmd"
				aria-label={`Copy: ${command}`}
				title="Copy"
				onClick={() => void copy()}
				className="flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
			>
				{copied ? <Check className="size-3.5 text-green" /> : <Copy className="size-3.5" />}
			</button>
		</div>
	);
}
