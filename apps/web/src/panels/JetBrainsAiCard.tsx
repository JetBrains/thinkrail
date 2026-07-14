import type { JbcentralInstall } from "@thinkrail/contracts";
import { Check, Copy, ExternalLink, Loader2, LogOut, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getTransport } from "@/transport";

const LOGIN_CMD = "central login";

/**
 * The outcome of the last in-app connect attempt — and *only* that. It holds the states the server-derived
 * `wired`/`installed` props can't express on their own: props say "not wired", but not *why* (never tried vs.
 * not signed in vs. a hard error). The install *command* itself never lives here — it comes from the host as
 * the `install` prop (per the host's OS). Facts we already have from props (connected, installed) are read
 * straight from the props — never copied in here — so local state can't silently disagree with the host.
 */
type ConnectResult =
	| { kind: "needs-login" }
	| { kind: "needs-install" }
	| { kind: "error"; message: string };

/**
 * The JetBrains AI option in the Providers settings: route Claude + GPT through the local `jbcentral` proxy
 * using your JetBrains subscription. A small state machine over the host's central CLI —
 * connected (Disconnect) / ready (Connect) / not signed in (in-app `central login` + retry) / not installed
 * (install guidance + Recheck). `wired`/`installed` come from the `provider.status` the pane already fetched
 * (the source of truth); `result` layers on only the last connect attempt's outcome; `onChanged` re-reads
 * status after a mutation.
 */
export function JetBrainsAiCard({
	wired,
	installed,
	install,
	onChanged,
}: {
	wired: boolean;
	installed: boolean;
	/** The host's per-OS install command (from `provider.status`), rendered when the CLI isn't installed.
	 * `undefined` only before the first status read (the card falls back to text-only guidance). */
	install?: JbcentralInstall | undefined;
	onChanged: () => void | Promise<void>;
}) {
	const [result, setResult] = useState<ConnectResult | null>(null);
	const [busy, setBusy] = useState(false);
	const [signingIn, setSigningIn] = useState(false);
	const [loginLaunched, setLoginLaunched] = useState(false);

	// `result` describes the *last attempt*; a change in the server-derived facts supersedes it. Once wired
	// (including an external terminal `central` re-wire picked up on Refresh) drop it entirely; once
	// installed, drop a stale needs-install (installing doesn't resolve a needs-login/error, so those stay).
	useEffect(() => {
		if (wired) {
			setResult(null);
			setLoginLaunched(false);
		} else if (installed) {
			setResult((r) => (r?.kind === "needs-install" ? null : r));
		}
	}, [wired, installed]);

	const connect = useCallback(async () => {
		setBusy(true);
		try {
			const r = await getTransport().request("provider.jbcentralConnect", {});
			if (r.outcome === "connected") {
				setResult(null);
				setLoginLaunched(false);
				await onChanged();
			} else if (r.outcome === "needs-install") {
				setResult({ kind: "needs-install" });
			} else if (r.outcome === "needs-login") {
				setResult({ kind: "needs-login" });
			} else {
				setResult({ kind: "error", message: r.message || "Couldn't connect to JetBrains AI." });
			}
		} catch {
			setResult({ kind: "error", message: "Couldn't reach the host." });
		} finally {
			setBusy(false);
		}
	}, [onChanged]);

	const disconnect = useCallback(async () => {
		setBusy(true);
		try {
			await getTransport().request("provider.jbcentralDisconnect", {});
			setResult(null);
			setLoginLaunched(false);
			await onChanged();
		} finally {
			setBusy(false);
		}
	}, [onChanged]);

	// Gate concurrent spawns — without this, rapid clicks launch multiple `central login` processes.
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

	// The not-installed state is known up front from status (`!installed`, no click needed); a failed connect
	// can also surface it. Either way the command comes from the host's `install` prop (its OS, not the
	// browser's) — so remote/phone clients still show the command for the machine running the host.
	const showInstall = !wired && (result?.kind === "needs-install" || !installed);
	const showLogin = !wired && result?.kind === "needs-login";
	const errorMsg = result?.kind === "error" ? result.message : "";

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
						{install?.shell === "powershell"
							? "Install the JetBrains Central CLI (central) in PowerShell, then Recheck:"
							: "Install the JetBrains Central CLI (central), then Recheck:"}
					</p>
					{install ? <CopyableCommand command={install.command} /> : null}
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

			{showLogin ? (
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

			{!wired && result?.kind === "error" ? (
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
