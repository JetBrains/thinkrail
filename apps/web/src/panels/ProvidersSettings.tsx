import {
	RiKeyLine as KeyRound,
	RiLockLine as Lock,
	RiLoginBoxLine as LogIn,
	RiLogoutBoxLine as LogOut,
} from "@remixicon/react";
import {
	type AppConfigUpdate,
	JBCENTRAL_QUOTA_PROTOCOL_VERSION,
	type ProviderStatus,
	type ProviderStatusReport,
} from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoginDialog } from "@/auth";
import { AUTH_KIND_LABEL } from "@/chat/modelPicker";
import { SkeletonRows } from "@/components/Skeleton";
import { selectLoginBusy, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { JetBrainsAiCard } from "./JetBrainsAiCard";
import { SettingsGroup, SettingsPageContainer } from "./SettingsGroup";

const API_KEY_VISIBLE = 8;
const MAX_REST_NAMES = 5;

export function ProvidersSettings() {
	const [report, setReport] = useState<ProviderStatusReport | null>(null);
	const [failed, setFailed] = useState(false);
	const [busyProvider, setBusyProvider] = useState<string | null>(null);
	const [showAllKeys, setShowAllKeys] = useState(false);
	const activeLogin = useAppStore((s) => (s.activeLogin?.target ? null : s.activeLogin));
	const loginBusy = useAppStore(selectLoginBusy);
	const providerVersion = useAppStore((s) => s.providerVersion);
	const providersRefreshRequest = useAppStore((s) => s.providersRefreshRequest);
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
		try {
			const next = await getTransport().request("provider.status", {});
			if (!isCurrent()) return;
			setReport(next);
			setFailed(false);
		} catch {
			if (!isCurrent()) return;
			setFailed(true);
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

	// Respond to external refresh requests (from sidebar refresh icon)
	useEffect(() => {
		if (providersRefreshRequest > 0) void load();
	}, [providersRefreshRequest, load]);

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

	// Loading state: show skeleton
	if (report == null && !failed) {
		return (
			<div data-testid="settings-providers">
				<SkeletonRows rows={3} />
			</div>
		);
	}

	// Failed state: show error
	if (failed) {
		return (
			<div data-testid="settings-providers">
				<p data-testid="providers-error" className="text-text-muted tr-text-ui">
					Couldn't read provider status — try Refresh in the sidebar.
				</p>
			</div>
		);
	}

	return (
		<>
			<SettingsPageContainer testId="settings-providers">
				{/* GROUP 1: Connected providers */}
				{configured.length > 0 && (
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
				)}

				{/* GROUP 2: JetBrains AI */}
				{report && (
					<JetBrainsAiCard
						status={report.jbcentral}
						install={report.jbcentralInstall}
						onChanged={load}
						{...(quotaSettings ? { quotaSettings } : {})}
					/>
				)}

				{/* GROUP 3: Subscriptions */}
				{subscriptionRows.length > 0 && (
					<SettingsGroup title="Subscriptions" description="Use your existing subscriptions">
						{subscriptionRows.map((p) => (
							<SubscriptionRow
								key={p.id}
								provider={p}
								busy={rowBusy(p.id)}
								onSignIn={() => void startLogin(p.id, "oauth")}
							/>
						))}
					</SettingsGroup>
				)}

				{/* GROUP 4: Available providers (API key only) */}
				{apiKeyRows.length > 0 && (
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
						{hiddenKeyCount > 0 && !showAllKeys && (
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
						)}
						{showAllKeys && hiddenKeyCount > 0 && (
							<div className="pt-8">
								<Button
									variant="outline"
									size="sm"
									data-testid="providers-show-less"
									onClick={() => setShowAllKeys(false)}
								>
									Show less
								</Button>
							</div>
						)}
					</SettingsGroup>
				)}

				{noInApp.length > 0 && (
					<p data-testid="providers-more" className="text-text-muted tr-text-metadata">
						{noInApp.length} more configured externally:{" "}
						{noInApp
							.slice(0, MAX_REST_NAMES)
							.map((p) => p.name)
							.join(", ")}
						{noInApp.length > MAX_REST_NAMES ? ", …" : ""}
					</p>
				)}
			</SettingsPageContainer>

			{activeLogin && (
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
			)}
		</>
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
		provider.kind === "central" ? "Connected through JetBrains AI" : "Configured externally";

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

function SubscriptionRow({
	provider,
	busy,
	onSignIn,
}: {
	provider: ProviderStatus;
	busy: boolean;
	onSignIn: () => void;
}) {
	return (
		<div
			data-testid="provider-subscription-row"
			data-provider={provider.id}
			className="flex items-center gap-8 border-border-muted border-b py-12"
		>
			<span className="min-w-0 flex-1 truncate tr-text-ui text-text-default">{provider.name}</span>
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
