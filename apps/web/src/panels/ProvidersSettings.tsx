import {
	RiKeyLine as KeyRound,
	RiLockLine as Lock,
	RiLoginBoxLine as LogIn,
	RiLogoutBoxLine as LogOut,
	RiRefreshLine as RefreshCw,
} from "@remixicon/react";
import {
	type AppConfigUpdate,
	JBCENTRAL_QUOTA_PROTOCOL_VERSION,
	type ProviderStatus,
	type ProviderStatusReport,
} from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import { SkeletonRows } from "@thinkrail/ui/skeleton";
import { cn } from "@thinkrail/ui/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoginDialog } from "@/auth";
import { AUTH_KIND_LABEL } from "@/chat/modelPicker";
import { selectLoginBusy, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { JetBrainsAiCard } from "./JetBrainsAiCard";
import { SettingsGroup, SettingsPageContainer } from "./SettingsGroup";

const API_KEY_VISIBLE = 8;
const MAX_REST_NAMES = 5;

export function ProvidersSettings() {
	const [report, setReport] = useState<ProviderStatusReport | null>(null);
	const [failed, setFailed] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [busyProvider, setBusyProvider] = useState<string | null>(null);
	const [showAllKeys, setShowAllKeys] = useState(false);
	const activeLogin = useAppStore((s) => (s.activeLogin?.target ? null : s.activeLogin));
	const loginBusy = useAppStore(selectLoginBusy);
	const providerVersion = useAppStore((s) => s.providerVersion);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const quotaEnabled = useAppStore((s) => s.jbcentralQuotaEnabled);
	const quotaRefreshSeconds = useAppStore((s) => s.jbcentralQuotaRefreshSeconds);
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
		if (!useAppStore.getState().reserveLogin()) return;
		setBusyProvider(providerId);
		try {
			const { loginId } = await getTransport().request("provider.loginStart", { providerId, type });
			useAppStore.getState().beginLogin(loginId, providerId);
		} catch (err) {
			toast.error(errorText(err), "Couldn't start the connection");
		} finally {
			useAppStore.getState().finishLoginStart();
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

	const saveQuotaSetting = useCallback(async (config: AppConfigUpdate) => {
		try {
			await getTransport().request("settings.update", { config });
		} catch (error) {
			toast.error(errorText(error), "Couldn't save JetBrains quota settings");
			throw error;
		}
	}, []);

	const quotaSettings =
		protocolVersion !== null && protocolVersion >= JBCENTRAL_QUOTA_PROTOCOL_VERSION
			? {
					enabled: quotaEnabled,
					refreshSeconds: quotaRefreshSeconds,
					onEnabledChange: (enabled: boolean) =>
						saveQuotaSetting({ jbcentralQuotaEnabled: enabled }),
					onRefreshSecondsChange: (seconds: number) =>
						saveQuotaSetting({ jbcentralQuotaRefreshSeconds: seconds }),
				}
			: null;
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
	const rowBusy = (id: string) => busyProvider === id || loginBusy;

	return (
		<div data-testid="settings-providers" className="flex flex-col gap-24">
			<div className="flex items-center justify-between gap-12">
				<p className="tr-text-metadata text-text-muted">
					Connect at least one provider so the agent can run — a subscription or an API key.
				</p>
				<Button
					variant="ghost"
					size="sm"
					data-testid="providers-refresh"
					aria-label="Refresh provider status"
					disabled={refreshing}
					onClick={() => void load()}
				>
					<RefreshCw className={cn("size-14", refreshing && "animate-spin")} />
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
				<SettingsPageContainer>
					{configured.length > 0 ? (
						<SettingsGroup title="Connected">
							{configured.map((p) => (
								<ConnectedRow
									key={p.id}
									provider={p}
									busy={busyProvider === p.id}
									onSignOut={() => void logout(p.id)}
								/>
							))}
						</SettingsGroup>
					) : null}

					{report ? (
						<JetBrainsAiCard
							status={report.jbcentral}
							install={report.jbcentralInstall}
							onChanged={load}
							{...(quotaSettings ? { quotaSettings } : {})}
						/>
					) : null}

					{subscriptionRows.length > 0 ? (
						<SettingsGroup
							title="Subscriptions"
							description="Use your existing Claude, ChatGPT, or Copilot plan — no API key needed."
						>
							{subscriptionRows.map((p) => (
								<ProviderRow
									key={p.id}
									provider={p}
									busy={rowBusy(p.id)}
									onSignIn={() => void startLogin(p.id, "oauth")}
									onApiKey={() => void startLogin(p.id, "api_key")}
								/>
							))}
						</SettingsGroup>
					) : null}

					{apiKeyRows.length > 0 ? (
						<SettingsGroup title={`Available (${apiKeyRows.length})`}>
							{shownKeys.map((p) => (
								<ProviderRow
									key={p.id}
									provider={p}
									busy={rowBusy(p.id)}
									onSignIn={() => void startLogin(p.id, "oauth")}
									onApiKey={() => void startLogin(p.id, "api_key")}
								/>
							))}
							{hiddenKeyCount > 0 ? (
								<div className="pt-8">
									<Button
										variant="outline"
										size="sm"
										data-testid="providers-show-more"
										onClick={() => setShowAllKeys(true)}
									>
										Show {hiddenKeyCount} more
									</Button>
								</div>
							) : null}
						</SettingsGroup>
					) : null}

					{noInApp.length > 0 ? (
						<p data-testid="providers-more" className="text-text-muted tr-text-metadata">
							{noInApp.length} more configured outside the app (environment variables or
							models.json):{" "}
							{noInApp
								.slice(0, MAX_REST_NAMES)
								.map((p) => p.name)
								.join(", ")}
							{noInApp.length > MAX_REST_NAMES ? ", …" : ""}
						</p>
					) : null}
				</SettingsPageContainer>
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

function ConnectedRow({
	provider,
	busy,
	onSignOut,
}: {
	provider: ProviderStatus;
	busy: boolean;
	onSignOut: () => void;
}) {
	const label = provider.kind ? AUTH_KIND_LABEL[provider.kind] : "configured";
	const managedTitle =
		provider.kind === "central"
			? "Connected through JetBrains AI"
			: "Configured outside the app (environment / models.json)";

	return (
		<div
			data-testid="provider-row"
			data-provider={provider.id}
			data-configured="true"
			data-kind={provider.kind}
			className="flex items-center gap-8 border-border-muted border-b py-12"
		>
			<span className="min-w-0 flex-1 truncate tr-text-ui text-text-default">{provider.name}</span>
			<span className="truncate text-text-muted tr-text-metadata">
				{label}
				{provider.detail ? ` · ${provider.detail}` : ""}
			</span>
			{provider.canLogout ? (
				<Button
					variant="soft"
					size="sm"
					data-testid="provider-signout"
					data-provider={provider.id}
					disabled={busy}
					onClick={onSignOut}
				>
					<LogOut className="size-14" />
					Sign out
				</Button>
			) : (
				<span
					className="flex shrink-0 items-center gap-4 text-text-muted tr-text-metadata"
					title={managedTitle}
				>
					<Lock className="size-12" />
					Managed
				</span>
			)}
		</div>
	);
}

function ProviderRow({
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
			className="flex items-center gap-8 border-border-muted border-b py-12"
		>
			<span className="min-w-0 flex-1 truncate tr-text-ui text-text-default">{provider.name}</span>
			<div className="flex shrink-0 items-center gap-4">
				{provider.canOAuth && (
					<Button
						variant="soft"
						size="sm"
						data-testid="provider-signin"
						data-provider={provider.id}
						disabled={busy}
						onClick={onSignIn}
					>
						<LogIn className="size-14" />
						Sign in
					</Button>
				)}
				{provider.canApiKey && (
					<Button
						variant="outline"
						size="sm"
						data-testid="provider-apikey"
						data-provider={provider.id}
						disabled={busy}
						onClick={onApiKey}
					>
						<KeyRound className="size-14" />
						API key
					</Button>
				)}
			</div>
		</div>
	);
}
