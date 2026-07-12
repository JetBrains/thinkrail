import type { ProviderAuthKind, ProviderStatus, ProviderStatusReport } from "@thinkrail/contracts";
import { Boxes, Check, KeyRound, Lock, LogIn, LogOut, RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { LoginDialog } from "@/auth";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { JetBrainsAiCard } from "./JetBrainsAiCard";

/** Human label per auth kind (a configured provider's source suffix). */
const KIND_LABEL: Record<ProviderAuthKind, string> = {
	jbcentral: "JetBrains AI proxy",
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
 * settles, so an external `pi` `/login` or `thinkrail jbcentral` shows up on Refresh too.
 */
export function ProvidersSettings() {
	const [report, setReport] = useState<ProviderStatusReport | null>(null);
	const [failed, setFailed] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [busyProvider, setBusyProvider] = useState<string | null>(null);
	const [showAllKeys, setShowAllKeys] = useState(false);
	const activeLogin = useAppStore((s) => s.activeLogin);

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

	// A settled login (success) mutated auth.json + refreshed the registry host-side — re-read so the pane
	// reflects the new provider even while the terminal dialog is still up (closing it reveals the change).
	useEffect(() => {
		if (activeLogin?.status === "success") void load();
	}, [activeLogin?.status, load]);

	const startOAuth = useCallback(async (providerId: string) => {
		setBusyProvider(providerId);
		try {
			const { loginId } = await getTransport().request("provider.loginStart", { providerId });
			useAppStore.getState().beginLogin(loginId, providerId);
		} catch {
			// loginStart failing (offline) leaves no dialog — the Sign-in button stays available to retry.
		} finally {
			setBusyProvider(null);
		}
	}, []);

	const setApiKey = useCallback(
		async (providerId: string, key: string) => {
			setBusyProvider(providerId);
			try {
				await getTransport().request("provider.setApiKey", { providerId, key });
				await load();
			} finally {
				setBusyProvider(null);
			}
		},
		[load],
	);

	const logout = useCallback(
		async (providerId: string) => {
			setBusyProvider(providerId);
			try {
				await getTransport().request("provider.logout", { providerId });
				await load();
			} finally {
				setBusyProvider(null);
			}
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
	// Neither in-app path applies (multi-field creds — bedrock/vertex/azure): a note, not a row.
	const multiField = unconfigured.filter((p) => !p.canOAuth && !p.canApiKey);
	const loginProviderName =
		providers.find((p) => p.id === activeLogin?.providerId)?.name ?? activeLogin?.providerId ?? "";
	// While a login is modal (one at a time), hold the other in-app actions.
	const rowBusy = (id: string) => busyProvider === id || activeLogin !== null;

	return (
		<div data-testid="settings-providers" className="flex flex-col gap-lg">
			<div className="flex items-start justify-between gap-sm">
				<div className="flex flex-col gap-xs">
					<h3 className="font-medium text-md text-text">Model providers</h3>
					<p className="text-hint text-xs">
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
				<p className="text-hint text-sm">Loading providers…</p>
			) : failed ? (
				<p data-testid="providers-error" className="text-hint text-sm">
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
							className="flex flex-col gap-sm rounded-[var(--radius-lg)] border border-[var(--primary-40)] bg-[var(--primary-10)] p-md"
						>
							<div className="flex flex-col gap-0.5">
								<h4 className="font-medium text-sm text-text">Sign in with a subscription</h4>
								<p className="text-hint text-xs">
									Use your existing Claude, ChatGPT, or Copilot plan — no API key needed.
								</p>
							</div>
							<div className="flex flex-col gap-xs">
								{subscriptionRows.map((p) => (
									<ProviderActionRow
										key={p.id}
										provider={p}
										busy={rowBusy(p.id)}
										onSignIn={() => void startOAuth(p.id)}
										onSaveKey={(key) => void setApiKey(p.id, key)}
									/>
								))}
							</div>
						</section>
					) : null}

					<JetBrainsAiCard
						wired={report?.jbcentralWired ?? false}
						installed={report?.jbcentralInstalled ?? false}
						onChanged={load}
					/>

					{apiKeyRows.length > 0 ? (
						<Group title="Add an API key">
							{shownKeys.map((p) => (
								<ProviderActionRow
									key={p.id}
									provider={p}
									busy={rowBusy(p.id)}
									onSignIn={() => void startOAuth(p.id)}
									onSaveKey={(key) => void setApiKey(p.id, key)}
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

					{multiField.length > 0 ? (
						<p data-testid="providers-more" className="text-hint text-xs">
							{multiField.length} more need multi-field credentials (set up in a terminal):{" "}
							{multiField
								.slice(0, MAX_REST_NAMES)
								.map((p) => p.name)
								.join(", ")}
							{multiField.length > MAX_REST_NAMES ? ", …" : ""}
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
							.catch(() => {});
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
			<h4 className="font-medium text-muted text-xs uppercase tracking-wider">{title}</h4>
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
			className="flex items-center gap-md rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-md py-sm"
		>
			<span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--green-tint)] text-green">
				<Check className="size-4" />
			</span>
			<div className="flex min-w-0 flex-col">
				<span className="truncate font-medium text-sm text-text">{provider.name}</span>
				<span className="truncate text-hint text-xs">
					{label}
					{provider.detail ? ` · ${provider.detail}` : ""}
				</span>
			</div>
			{/* Only auth.json credentials are removable here — env / jbcentral / models.json auth can't be
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
					className="ml-auto flex shrink-0 items-center gap-xs text-hint text-xs"
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
 * inline API-key field (when `provider.canApiKey`) — a provider can offer both (anthropic: subscription or key).
 */
function ProviderActionRow({
	provider,
	busy,
	onSignIn,
	onSaveKey,
}: {
	provider: ProviderStatus;
	busy: boolean;
	onSignIn: () => void;
	onSaveKey: (key: string) => void;
}) {
	const [keyOpen, setKeyOpen] = useState(false);
	const [key, setKey] = useState("");

	const save = () => {
		if (key.trim()) onSaveKey(key.trim());
		setKey("");
		setKeyOpen(false);
	};

	return (
		<div
			data-testid="provider-signin-row"
			data-provider={provider.id}
			data-configured="false"
			className="flex flex-col gap-xs rounded-[var(--radius-md)] border border-border2 bg-[var(--input-bg)] px-md py-sm"
		>
			<div className="flex items-center gap-sm text-sm">
				<span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-hover text-muted">
					<Boxes className="size-4" />
				</span>
				<span className="min-w-0 flex-1 truncate text-text">{provider.name}</span>
				<div className="flex shrink-0 items-center gap-xs">
					{provider.canApiKey ? (
						<Button
							variant="ghost"
							size="sm"
							data-testid="provider-apikey-toggle"
							data-provider={provider.id}
							aria-expanded={keyOpen}
							onClick={() => setKeyOpen((v) => !v)}
						>
							<KeyRound className="size-3.5" />
							API key
						</Button>
					) : null}
					{provider.canOAuth ? (
						<Button
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

			{provider.canApiKey && keyOpen ? (
				<div className="flex gap-sm pl-[calc(2rem+var(--space-sm))]">
					<input
						data-testid="provider-apikey-input"
						data-provider={provider.id}
						type="password"
						// biome-ignore lint/a11y/noAutofocus: revealing the field should focus it for immediate entry.
						autoFocus
						value={key}
						placeholder={`${provider.name} API key`}
						disabled={busy}
						onChange={(e) => setKey(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && key.trim()) {
								e.preventDefault();
								save();
							}
						}}
						className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-border2 bg-bg px-sm py-xs text-sm text-text outline-none placeholder:text-hint focus:border-primary disabled:opacity-50"
					/>
					<Button
						size="sm"
						data-testid="provider-apikey-save"
						data-provider={provider.id}
						disabled={busy || !key.trim()}
						onClick={save}
					>
						Save
					</Button>
				</div>
			) : null}
		</div>
	);
}
