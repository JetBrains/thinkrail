import type { ProviderAuthKind, ProviderStatus, ProviderStatusReport } from "@thinkrail/contracts";
import { Check, Copy, RefreshCw, TriangleAlert } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { getTransport } from "@/transport";

/** Human label per auth kind (the row's source suffix). */
const KIND_LABEL: Record<ProviderAuthKind, string> = {
	jbcentral: "JetBrains AI proxy",
	oauth: "OAuth subscription",
	"api-key": "API key",
	env: "environment",
	other: "configured",
};

/** How many unconfigured provider names the compact line spells out before eliding. */
const MAX_REST_NAMES = 4;

/**
 * The Welcome screen's auth-provider status strip (decided in task-auth-provider-status): one
 * `provider.status` fetch on mount, a Refresh that re-asks (every read revalidates host-side, so an
 * external `pi` `/login` or `thinkrail jbcentral` shows up on Refresh without a host restart).
 * Read-only + copyable guidance — no in-app login/wiring actions.
 */
export function ProviderStatusStrip() {
	const [report, setReport] = useState<ProviderStatusReport | null>(null);
	const [failed, setFailed] = useState(false);
	const [refreshing, setRefreshing] = useState(false);

	const load = useCallback(async () => {
		setRefreshing(true);
		try {
			setReport(await getTransport().request("provider.status", {}));
			setFailed(false);
		} catch {
			setFailed(true);
		} finally {
			setRefreshing(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	// First load still in flight — render nothing rather than a flash of skeleton (hasSpecs precedent).
	if (report == null && !failed) return null;

	const configured = report?.providers.filter((p) => p.configured) ?? [];
	const rest = report?.providers.filter((p) => !p.configured) ?? [];

	return (
		<section
			data-testid="welcome-providers"
			className="mt-xl w-full max-w-[560px] rounded-[var(--radius-lg)] border border-border2 bg-bg p-lg text-left"
		>
			<div className="flex items-center justify-between gap-sm">
				<h2 className="font-medium text-muted text-xs uppercase tracking-wider">Model providers</h2>
				<button
					type="button"
					data-testid="providers-refresh"
					aria-label="Refresh provider status"
					title="Refresh provider status"
					disabled={refreshing}
					onClick={() => void load()}
					className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-muted outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
				>
					<RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
				</button>
			</div>

			{failed ? (
				// Offline ≠ "no providers" — a fetch failure gets its own hint (SpecsPanel precedent).
				<p data-testid="providers-error" className="mt-sm text-hint text-xs">
					Couldn't read the provider status from the host — try Refresh.
				</p>
			) : configured.length > 0 ? (
				<>
					<ul className="mt-sm flex flex-col gap-xs">
						{configured.map((p) => (
							<ProviderRow key={p.id} provider={p} />
						))}
					</ul>
					{rest.length > 0 ? (
						<p data-testid="providers-more" className="mt-sm text-hint text-xs">
							{rest.length} more available:{" "}
							{rest
								.slice(0, MAX_REST_NAMES)
								.map((p) => p.name)
								.join(", ")}
							{rest.length > MAX_REST_NAMES ? ", …" : ""}
						</p>
					) : null}
				</>
			) : (
				<NoProvidersGuidance />
			)}
		</section>
	);
}

/** One configured provider: glyph + display name + auth-source label (+ optional hint). */
function ProviderRow({ provider }: { provider: ProviderStatus }) {
	const label = provider.kind ? KIND_LABEL[provider.kind] : "configured";
	return (
		<li
			data-testid="provider-row"
			data-provider={provider.id}
			data-configured="true"
			className="flex items-center gap-sm text-sm"
		>
			<Check className="size-3.5 shrink-0 text-green" />
			<span className="truncate text-text">{provider.name}</span>
			<span className="truncate text-hint text-xs">
				· {label}
				{provider.detail ? ` (${provider.detail})` : ""}
			</span>
		</li>
	);
}

/** Zero configured providers — warn-toned guidance with the (verified) copyable setup commands. */
function NoProvidersGuidance() {
	return (
		<div data-testid="providers-empty" className="mt-sm flex flex-col gap-sm">
			<p className="flex items-center gap-sm font-medium text-gold text-sm">
				<TriangleAlert className="size-3.5 shrink-0" />
				No model providers configured
			</p>
			<p className="text-muted text-xs">
				The agent needs at least one authenticated provider. Set one up in a terminal, then Refresh:
			</p>
			<CommandRow
				command="thinkrail jbcentral"
				explainer="Route Claude + GPT through your JetBrains AI subscription."
			/>
			<CommandRow
				command="pi"
				explainer={
					<>
						Then type <code className="font-[var(--font-mono)] text-text">/login</code> inside pi to
						sign in with a provider subscription.
					</>
				}
			/>
			<p className="text-hint text-xs">
				Or export a provider API key (e.g.{" "}
				<code className="font-[var(--font-mono)]">ANTHROPIC_API_KEY</code>) before launching
				ThinkRail.
			</p>
		</div>
	);
}

/** A copyable shell command with a one-line explainer. */
function CommandRow({ command, explainer }: { command: string; explainer: ReactNode }) {
	const [copied, setCopied] = useState(false);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(command);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard unavailable (permissions / insecure context) — the command is still selectable text.
		}
	};

	return (
		<div className="flex items-center gap-sm rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-md py-sm">
			<code className="shrink-0 font-[var(--font-mono)] text-sm text-text">{command}</code>
			<span className="min-w-0 truncate text-hint text-xs">{explainer}</span>
			<button
				type="button"
				data-testid="provider-copy-cmd"
				data-cmd={command}
				data-copied={copied}
				aria-label={`Copy ${command}`}
				title={`Copy ${command}`}
				onClick={() => void copy()}
				className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary"
			>
				{copied ? <Check className="size-3.5 text-green" /> : <Copy className="size-3.5" />}
			</button>
		</div>
	);
}
