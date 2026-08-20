import type { ProviderAuthKind, ProviderStatus, ProviderStatusReport } from "@thinkrail/contracts";
import { Boxes, Check, KeyRound, Lock, LogIn, LogOut, RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { LoginDialog } from "@/auth";
import { Button } from "@/components/ui/button";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { JetBrainsAiCard } from "./JetBrainsAiCard";

/** Human label per auth kind (a configured provider's source suffix). */
const KIND_LABEL: Record<ProviderAuthKind, string> = {
	oauth: "OAuth subscription",
	"api-key": "API key",
	env: "environment",
	other: "configured",
};

/** How many single-key API-key providers to show before the "Show N more" expander (pi registers ~20). */
const API_KEY_VISIBLE = 6;
/** How many non-actionable (multi-field) provider names the compact line spells out before eliding. */
const MAX_REST_NAMES = 5;

/**
 * The Providers section of the Settings dialog — the in-app model-provider auth surface (moved here from the
 * old Welcome strip). One `provider.status` fetch on mount (every read revalidates host-side), plus in-app
 * auth: Sign-in (OAuth subscriptions), inline API-key entry, and Sign-out — each re-reads status when it
 * settles, so an external `pi` `/login` (or a terminal Central configuration change) shows up on Refresh too.
 */
export function ProvidersSettings() {
	const [report, setReport] = useState<ProviderStatusReport | null>(null);
	const [failed, setFailed] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [busyProvider, setBusyProvider] = useState<string | null>(null);
	const [showAllKeys, setShowAllKeys] = useState(false);
	const activeLogin = useAppStore((s) => s.activeLogin);
	const providerVersion = useAppStore((s) => s.providerVersion);
	const loadSequence = useRef(0);

	/** Re-reads provider status. Never rejects — a failed read renders the pane's error banner instead. */
	const load = useCallback(async () => {
		const sequence = ++loadSequence.current;
		const providerVersion = useAppStore.getState().providerVersion;
		const isCurrent = () =>
			sequence === loadSequence.current &&
			providerVersion === useAppStore.getState().providerVersion;
		setRefreshing(true);
		try {
			const next = await getTransport().request("provider.status", {});
			if (!isCurrent()) return;
			setReport(next);
			setFailed(false);
		} catch {
			if (!isCurrent()) return;
			setFailed(true);
		} finally {
			if (sequence === loadSequence.current) setRefreshing(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (providerVersion > 0) void load();
	}, [providerVersion, load]);

	// A settled login (success) mutated auth.json + refreshed the registry host-side — re-read so the pane
	// reflects the new provider even while the terminal dialog is still up (closing it reveals the change).
	useEffect(() => {
		if (activeLogin?.status === "success") void load();
	}, [activeLogin?.status, load]);

	// One starter for both auth types: OAuth and interactive API-key entry ride the same login channel
	// (issue #97) — the LoginDialog renders whatever frames the provider-owned flow pushes.
	const startLogin = useCallback(async (providerId: string, type: "oauth" | "api_key") => {
		setBusyProvider(providerId);
		try {
			const { loginId } = await getTransport().request("provider.loginStart", { providerId, type });
			useAppStore.getState().beginLogin(loginId, providerId);
		} catch (err) {
			// loginStart failing (offline) leaves no dialog — surface why; the button stays for a retry.
			toast.error(errorText(err), "Couldn't start the connection");
		} finally {
			setBusyProvider(null);
		}
	}, []);

	const logout = useCallback(
		async (providerId: string) => {
			setBusyProvider(providerId);
			try {
				await getTransport().request("provider.logout", { providerId });
			} catch (err) {
				// A failed sign-out leaves the card still showing signed-in — surface why.
				toast.error(errorText(err), "Couldn't sign out");
				return;
			} finally {
				setBusyProvider(null);
			}
			await load();
		},
		[load],
	);

	const providers = report?.providers ?? [];
	const configured = providers.filter((p) => p.configured);
	const unconfigured = providers.filter((p) => !p.configured);
	const subscriptionRows = unconfigured.filter((p) => p.canOAuth);
	const apiKeyRows = unconfigured.filter((p) => p.canApiKey && !p.canOAuth);
	const shownKeys = showAllKeys ? apiKeyRows : apiKeyRows.slice(0, API_KEY_VISIBLE);
	const hiddenKeyCount = apiKeyRows.length - shownKeys.length;
	// Neither in-app path applies (ambient-only auth — env vars / models.json customs): a note, not a row.
	const noInApp = unconfigured.filter((p) => !p.canOAuth && !p.canApiKey);
	const loginProviderName =
		providers.find((p) => p.id === activeLogin?.providerId)?.name ?? activeLogin?.providerId ?? "";
	// While a login is modal (one at a time), hold the other in-app actions.
	const rowBusy = (id: string) => busyProvider === id || activeLogin !== null;

	return (
		<div data-testid="settings-providers" className="flex flex-col gap-lg">
			<div className="flex items-start justify-between gap-sm">
				<div className="flex flex-col gap-xs">
					<h3 className="tr-title-section text-text-default">Model providers</h3>
					<p className="text-text-muted tr-text-metadata">
						Connect at least one provider so the agent can run — a subscription or an API key.
					</p>
				</div>
				<Button
					variant="ghost"
					size="sm"
					data-testid="providers-refresh"
					aria-label="Refresh provider status"
					title="Refresh"
					disabled={refreshing}
					onClick={() => void load()}
				>
					<RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
					Refresh
				</Button>
			</div>

			{report == null && !failed ? (
				<p className="text-text-muted tr-text-ui">Loading providers…</p>
			) : failed ? (
				<p data-testid="providers-error" className="text-text-muted tr-text-ui">
					Couldn't read the provider status from the host — try Refresh.
				</p>
			) : (
				<>
					{configured.length > 0 ? (
						<Group title="Connected">
							{configured.map((p) => (
								<ConnectedCard
									key={p.id}
									provider={p}
									busy={busyProvider === p.id}
									onSignOut={() => void logout(p.id)}
								/>
							))}
						</Group>
					) : null}

					{subscriptionRows.length > 0 ? (
						<section
							data-testid="providers-subscriptions"
							className="flex flex-col gap-sm rounded-[var(--radius-sm)] border border-primary-muted bg-clip-padding bg-primary-subtle p-md"
						>
							<div className="flex flex-col gap-0.5">
								<h4 className="tr-title-compact text-text-default">Sign in with a subscription</h4>
								<p className="text-text-muted tr-text-metadata">
									Use your existing Claude, ChatGPT, or Copilot plan — no API key needed.
								</p>
							</div>
							<div className="flex flex-col gap-xs">
								{subscriptionRows.map((p) => (
									<ProviderActionRow
										key={p.id}
										provider={p}
										busy={rowBusy(p.id)}
										onSignIn={() => void startLogin(p.id, "oauth")}
										onApiKey={() => void startLogin(p.id, "api_key")}
									/>
								))}
							</div>
						</section>
					) : null}

					{report ? (
						<JetBrainsAiCard
							status={report.jbcentral}
							install={report.jbcentralInstall}
							onChanged={load}
						/>
					) : null}

					{apiKeyRows.length > 0 ? (
						<Group title="Add an API key">
							{shownKeys.map((p) => (
								<ProviderActionRow
									key={p.id}
									provider={p}
									busy={rowBusy(p.id)}
									onSignIn={() => void startLogin(p.id, "oauth")}
									onApiKey={() => void startLogin(p.id, "api_key")}
								/>
							))}
							{hiddenKeyCount > 0 ? (
								<Button
									variant="ghost"
									size="sm"
									data-testid="providers-show-more"
									onClick={() => setShowAllKeys(true)}
									className="self-start"
								>
									Show {hiddenKeyCount} more
								</Button>
							) : null}
						</Group>
					) : null}

					{noInApp.length > 0 ? (
						<p data-testid="providers-more" className="text-text-muted tr-text-metadata">
							{noInApp.length} more are configured outside the app (environment variables or
							models.json):{" "}
							{noInApp
								.slice(0, MAX_REST_NAMES)
								.map((p) => p.name)
								.join(", ")}
							{noInApp.length > MAX_REST_NAMES ? ", …" : ""}
						</p>
					) : null}
				</>
			)}

			{activeLogin ? (
				<LoginDialog
					key={activeLogin.loginId}
					state={activeLogin}
					providerName={loginProviderName}
					onReply={(value) => {
						getTransport()
							.request("provider.loginReply", { loginId: activeLogin.loginId, value })
							// A dropped reply strands the login waiting on input that never arrives — surface it.
							.catch((err) => toast.error(errorText(err), "Couldn't submit"));
						useAppStore.getState().clearLoginInput();
					}}
					onCancel={() => {
						getTransport()
							.request("provider.loginCancel", { loginId: activeLogin.loginId })
							.catch(() => {});
						useAppStore.getState().clearLogin();
					}}
					onClose={() => {
						useAppStore.getState().clearLogin();
						void load();
					}}
				/>
			) : null}
		</div>
	);
}

/** A labelled group of provider rows/cards. */
function Group({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-sm">
			<h4 className="tr-text-eyebrow text-text-muted">{title}</h4>
			<div className="flex flex-col gap-xs">{children}</div>
		</section>
	);
}

/** A connected provider: an icon tile + name + auth-source label, and a Sign-out when it's removable. */
function ConnectedCard({
	provider,
	busy,
	onSignOut,
}: {
	provider: ProviderStatus;
	busy: boolean;
	onSignOut: () => void;
}) {
	const label = provider.kind ? KIND_LABEL[provider.kind] : "configured";
	return (
		<div
			data-testid="provider-row"
			data-provider={provider.id}
			data-configured="true"
			className="flex items-center gap-md rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-md py-sm"
		>
			<span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-feedback-success-subtle text-feedback-success">
				<Check className="size-4" />
			</span>
			<div className="flex min-w-0 flex-col">
				<span className="truncate tr-text-ui text-text-default">{provider.name}</span>
				<span className="truncate text-text-muted tr-text-metadata">
					{label}
					{provider.detail ? ` · ${provider.detail}` : ""}
				</span>
			</div>
			{/* Only auth.json credentials are removable here — env / central / models.json auth can't be
			    unset by the host, so it shows a "Managed" tag instead of a Sign-out that would silently no-op. */}
			{provider.canLogout ? (
				<Button
					variant="outline"
					size="sm"
					data-testid="provider-signout"
					data-provider={provider.id}
					disabled={busy}
					onClick={onSignOut}
					className="ml-auto"
				>
					<LogOut className="size-3.5" />
					Sign out
				</Button>
			) : (
				<span
					className="ml-auto flex shrink-0 items-center gap-xs text-text-muted tr-text-metadata"
					title="Configured outside the app (environment / models.json)"
				>
					<Lock className="size-3" />
					Managed
				</span>
			)}
		</div>
	);
}

/**
 * An unconfigured provider offering in-app auth: a "Sign in" button (when `provider.canOAuth`) and/or an
 * "API key" button (when `provider.canApiKey`) — a provider can offer both (anthropic: subscription or
 * key). Both routes open the same LoginDialog; the API-key flow runs the provider's own prompts over
 * the login channel (multi-prompt creds like azure/vertex included — issue #97), so no inline field.
 */
function ProviderActionRow({
	provider,
	busy,
	onSignIn,
	onApiKey,
}: {
	provider: ProviderStatus;
	busy: boolean;
	onSignIn: () => void;
	onApiKey: () => void;
}) {
	return (
		<div
			data-testid="provider-signin-row"
			data-provider={provider.id}
			data-configured="false"
			className="flex flex-col gap-xs rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-md py-sm"
		>
			<div className="flex items-center gap-sm tr-text-ui">
				<span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-control-bg-selected text-text-muted">
					<Boxes className="size-4" />
				</span>
				<span className="min-w-0 flex-1 truncate text-text-default">{provider.name}</span>
				<div className="flex shrink-0 items-center gap-xs">
					{provider.canApiKey ? (
						<Button
							variant={provider.canOAuth ? "outline" : "default"}
							size="sm"
							data-testid="provider-apikey"
							data-provider={provider.id}
							disabled={busy}
							onClick={onApiKey}
						>
							<KeyRound className="size-3.5" />
							API key
						</Button>
					) : null}
					{provider.canOAuth ? (
						<Button
							variant="default"
							size="sm"
							data-testid="provider-signin"
							data-provider={provider.id}
							disabled={busy}
							onClick={onSignIn}
						>
							<LogIn className="size-3.5" />
							Sign in
						</Button>
					) : null}
				</div>
			</div>
		</div>
	);
}
