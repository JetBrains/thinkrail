import {
	RiStackLine as Boxes,
	RiCheckLine as Check,
	RiKeyLine as KeyRound,
	RiLockLine as Lock,
	RiLoginBoxLine as LogIn,
	RiLogoutBoxLine as LogOut,
	RiRefreshLine as RefreshCw,
} from "@remixicon/react";
import type { ProviderAuthKind, ProviderStatus, ProviderStatusReport } from "@thinkrail/contracts";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { LoginDialog } from "@/auth";
import { SkeletonRows } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { JetBrainsAiCard } from "./JetBrainsAiCard";

const KIND_LABEL: Record<ProviderAuthKind, string> = {
	oauth: "OAuth subscription",
	"api-key": "API key",
	env: "environment",
	other: "configured",
};

const API_KEY_VISIBLE = 6;
const MAX_REST_NAMES = 5;

export function ProvidersSettings() {
	const [report, setReport] = useState<ProviderStatusReport | null>(null);
	const [failed, setFailed] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [busyProvider, setBusyProvider] = useState<string | null>(null);
	const [showAllKeys, setShowAllKeys] = useState(false);
	const activeLogin = useAppStore((s) => s.activeLogin);
	const providerVersion = useAppStore((s) => s.providerVersion);
	const loadSequence = useRef(0);

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

	useEffect(() => {
		if (activeLogin?.status === "success") void load();
	}, [activeLogin?.status, load]);

	const startLogin = useCallback(async (providerId: string, type: "oauth" | "api_key") => {
		setBusyProvider(providerId);
		try {
			const { loginId } = await getTransport().request("provider.loginStart", { providerId, type });
			useAppStore.getState().beginLogin(loginId, providerId);
		} catch (err) {
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
	const noInApp = unconfigured.filter((p) => !p.canOAuth && !p.canApiKey);
	const loginProviderName =
		providers.find((p) => p.id === activeLogin?.providerId)?.name ?? activeLogin?.providerId ?? "";
	const rowBusy = (id: string) => busyProvider === id || activeLogin !== null;

	return (
		<div data-testid="settings-providers" className="flex flex-col gap-16">
			<div className="flex items-start justify-between gap-8">
				<div className="flex flex-col gap-4">
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
					disabled={refreshing}
					onClick={() => void load()}
				>
					<RefreshCw className={`size-14 ${refreshing ? "animate-spin" : ""}`} />
					Refresh
				</Button>
			</div>

			{report == null && !failed ? (
				<SkeletonRows rows={3} />
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
							className="flex flex-col gap-8 rounded-[var(--radius-sm)] border border-primary-muted bg-clip-padding bg-primary-subtle p-12"
						>
							<div className="flex flex-col gap-2">
								<h4 className="tr-title-compact text-text-default">Sign in with a subscription</h4>
								<p className="text-text-muted tr-text-metadata">
									Use your existing Claude, ChatGPT, or Copilot plan — no API key needed.
								</p>
							</div>
							<div className="flex flex-col gap-4">
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

function Group({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-8">
			<h4 className="tr-text-eyebrow text-text-muted">{title}</h4>
			<div className="flex flex-col gap-4">{children}</div>
		</section>
	);
}

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
			className="flex items-center gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8"
		>
			<span className="flex size-32 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-feedback-success-subtle text-feedback-success">
				<Check className="size-16" />
			</span>
			<div className="flex min-w-0 flex-col">
				<span className="truncate tr-text-ui text-text-default">{provider.name}</span>
				<span className="truncate text-text-muted tr-text-metadata">
					{label}
					{provider.detail ? ` · ${provider.detail}` : ""}
				</span>
			</div>
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
					<LogOut className="size-14" />
					Sign out
				</Button>
			) : (
				<span
					className="ml-auto flex shrink-0 items-center gap-4 text-text-muted tr-text-metadata"
					title="Configured outside the app (environment / models.json)"
				>
					<Lock className="size-12" />
					Managed
				</span>
			)}
		</div>
	);
}

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
			className="flex flex-col gap-4 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8"
		>
			<div className="flex items-center gap-8 tr-text-ui">
				<span className="flex size-32 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-control-bg-selected text-text-muted">
					<Boxes className="size-16" />
				</span>
				<span className="min-w-0 flex-1 truncate text-text-default">{provider.name}</span>
				<div className="flex shrink-0 items-center gap-4">
					{provider.canApiKey ? (
						<Button
							variant={provider.canOAuth ? "outline" : "default"}
							size="sm"
							data-testid="provider-apikey"
							data-provider={provider.id}
							disabled={busy}
							onClick={onApiKey}
						>
							<KeyRound className="size-14" />
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
							<LogIn className="size-14" />
							Sign in
						</Button>
					) : null}
				</div>
			</div>
		</div>
	);
}
