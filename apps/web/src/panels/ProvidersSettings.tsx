import {
	RiLockLine as Lock,
	RiLogoutBoxLine as LogOut,
	RiRefreshLine as RefreshCw,
} from "@remixicon/react";
import { JBCENTRAL_QUOTA_PROTOCOL_VERSION, type ProviderStatus } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, withIconClass } from "@thinkrail/ui/button";
import { SkeletonRows } from "@thinkrail/ui/skeleton";
import { useState } from "react";
import { flushSync } from "react-dom";
import { AUTH_KIND_LABEL } from "@/chat/modelPicker";
import {
	SETTINGS_LIST_ROW,
	SettingsGroup,
	SettingsList,
	SettingsPage,
	SettingsRow,
	useSettingsListRow,
} from "@/settingsKit";
import { useAppStore } from "@/store";
import { CustomEndpointsSettings, useCustomEndpoints } from "./CustomEndpointsSettings";
import { JetBrainsAiSettings, type JetBrainsQuotaSettings } from "./JetBrainsAiCard";
import { ProviderRow } from "./ProviderRow";
import { saveSettings } from "./saveSettings";
import { useConfigReset } from "./settingDefaults";
import { SETTING, settingProps } from "./settingsCatalog";
import { useProviderAuth } from "./useProviderAuth";

const NAMED_PROVIDERS = 5;
const SpinningRefresh = withIconClass(RefreshCw, "motion-safe:animate-spin");
const AVAILABLE_LIST = "providers:available";

function namesOf(providers: readonly ProviderStatus[]): string {
	return providers
		.slice(0, NAMED_PROVIDERS)
		.map((p) => p.name)
		.join(", ");
}

export function ProvidersSettings() {
	const t = useT();
	const [showAllKeys, setShowAllKeys] = useState(false);
	const {
		report,
		failed,
		refreshing,
		load,
		startLogin,
		logout,
		busyProvider,
		rowBusy,
		loginDialog,
	} = useProviderAuth({ ownsLoginDialog: true });
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const quotaEnabled = useAppStore((s) => s.jbcentralQuotaEnabled);
	const quotaRefreshSeconds = useAppStore((s) => s.jbcentralQuotaRefreshSeconds);
	const quotaEnabledReset = useConfigReset(
		"jbcentralQuotaEnabled",
		"settings.providers.quotaSaveFailed",
	);
	const quotaIntervalReset = useConfigReset(
		"jbcentralQuotaRefreshSeconds",
		"settings.providers.quotaSaveFailed",
	);
	const customEndpoints = useCustomEndpoints();

	const quota: JetBrainsQuotaSettings | null =
		protocolVersion !== null && protocolVersion >= JBCENTRAL_QUOTA_PROTOCOL_VERSION
			? {
					enabled: quotaEnabled,
					refreshSeconds: quotaRefreshSeconds,
					enabledReset: quotaEnabledReset,
					intervalReset: quotaIntervalReset,
					onEnabledChange: (enabled) =>
						void saveSettings(
							{ jbcentralQuotaEnabled: enabled },
							t("settings.providers.quotaSaveFailed"),
						),
					onRefreshSecondsChange: (seconds) =>
						saveSettings(
							{ jbcentralQuotaRefreshSeconds: seconds },
							t("settings.providers.quotaSaveFailed"),
						),
				}
			: null;
	const shownElsewhere = new Set(customEndpoints?.endpoints?.map((endpoint) => endpoint.id));
	const providers = (report?.providers ?? []).filter((p) => !shownElsewhere.has(p.id));
	const configured = providers.filter((p) => p.configured);
	const unconfigured = providers.filter((p) => !p.configured);
	const subscriptionRows = unconfigured.filter((p) => p.canOAuth);
	const apiKeyRows = unconfigured.filter((p) => p.canApiKey && !p.canOAuth);
	const noInApp = unconfigured.filter((p) => !p.canOAuth && !p.canApiKey);

	const refresh = () => {
		void load();
		void customEndpoints?.load();
	};

	const showAllProviders = () => {
		flushSync(() => setShowAllKeys(true));
		document
			.querySelector<HTMLElement>(`[data-focus-list="${AVAILABLE_LIST}"] [data-focus-row-primary]`)
			?.focus();
	};

	return (
		<SettingsPage
			title={t("settings.nav.providers")}
			description={
				<span className="flex flex-wrap items-center justify-between gap-8">
					<span>{t("settings.providers.intro")}</span>
					<span data-setting-row="providers-refresh">
						<Button
							variant="ghost"
							size="m"
							iconLeft={refreshing ? SpinningRefresh : RefreshCw}
							tabIndex={0}
							aria-busy={refreshing || undefined}
							aria-disabled={refreshing || undefined}
							data-testid="providers-refresh"
							aria-label={t("settings.providers.refreshLabel")}
							onClick={() => {
								if (!refreshing) refresh();
							}}
						>
							{t("settings.providers.refresh")}
						</Button>
					</span>
				</span>
			}
			testId="settings-providers"
		>
			{report == null && !failed ? <SkeletonRows rows={3} /> : null}

			{report == null && failed ? (
				<SettingsRow
					rowId="providers-load-failed"
					label={t("settings.providers.loadFailed")}
					testId="providers-error"
					control={
						<Button
							variant="outline"
							size="m"
							tabIndex={0}
							data-testid="providers-retry"
							onClick={refresh}
						>
							{t("common.retry")}
						</Button>
					}
				/>
			) : null}

			{report && configured.length > 0 ? (
				<SettingsGroup title={t("settings.providers.connectedGroup")} testId="providers-signed-in">
					<SettingsList
						focusList="providers:signed-in"
						label={t("settings.providers.connectedGroup")}
						rowIds={configured.filter((p) => p.canLogout).map((p) => p.id)}
						settingId={SETTING.signedInProviders.id}
					>
						{configured.map((p) => (
							<SignedInRow
								key={p.id}
								provider={p}
								busy={busyProvider === p.id}
								onSignOut={() => void logout(p.id)}
							/>
						))}
					</SettingsList>
				</SettingsGroup>
			) : null}

			{report ? (
				<JetBrainsAiSettings
					status={report.jbcentral}
					install={report.jbcentralInstall}
					onChanged={load}
					quota={quota}
				/>
			) : null}

			{report && subscriptionRows.length > 0 ? (
				<SettingsGroup
					title={t("settings.providers.subscriptionsGroup")}
					description={t("settings.providers.subscriptionsDescription")}
					testId="providers-subscriptions"
				>
					<SettingsList
						focusList="providers:subscriptions"
						label={t("settings.providers.subscriptionsGroup")}
						rowIds={subscriptionRows.map((p) => p.id)}
						settingId={SETTING.subscriptions.id}
					>
						{subscriptionRows.map((p) => (
							<ListedProviderRow
								key={p.id}
								provider={p}
								busy={rowBusy(p.id)}
								onSignIn={() => void startLogin(p.id, "oauth")}
								onApiKey={() => void startLogin(p.id, "api_key")}
							/>
						))}
					</SettingsList>
				</SettingsGroup>
			) : null}

			{report && customEndpoints ? <CustomEndpointsSettings state={customEndpoints} /> : null}

			{report && apiKeyRows.length > 0 ? (
				<SettingsGroup
					title={t("settings.providers.availableGroup", { count: apiKeyRows.length })}
					testId="providers-available"
				>
					{showAllKeys ? (
						<SettingsList
							focusList={AVAILABLE_LIST}
							label={t("settings.catalog.apiKeyProviders.label")}
							rowIds={apiKeyRows.map((p) => p.id)}
							settingId={SETTING.apiKeyProviders.id}
						>
							{apiKeyRows.map((p) => (
								<ListedProviderRow
									key={p.id}
									provider={p}
									busy={rowBusy(p.id)}
									onSignIn={() => void startLogin(p.id, "oauth")}
									onApiKey={() => void startLogin(p.id, "api_key")}
								/>
							))}
						</SettingsList>
					) : (
						<SettingsRow
							{...settingProps(t, SETTING.apiKeyProviders)}
							description={
								apiKeyRows.length > NAMED_PROVIDERS
									? t("settings.providers.availableMore", {
											names: namesOf(apiKeyRows),
											count: apiKeyRows.length - NAMED_PROVIDERS,
										})
									: namesOf(apiKeyRows)
							}
							control={
								<Button
									variant="outline"
									size="m"
									tabIndex={0}
									data-testid="providers-show-more"
									onClick={showAllProviders}
								>
									{t("settings.providers.showAll", { count: apiKeyRows.length })}
								</Button>
							}
						/>
					)}
				</SettingsGroup>
			) : null}

			{report && noInApp.length > 0 ? (
				<p data-testid="providers-more" className="text-text-muted tr-text-metadata">
					{noInApp.length > NAMED_PROVIDERS
						? t("settings.providers.outsideAppTruncated", {
								count: noInApp.length,
								names: namesOf(noInApp),
							})
						: t("settings.providers.outsideApp", {
								count: noInApp.length,
								names: namesOf(noInApp),
							})}
				</p>
			) : null}

			{loginDialog}
		</SettingsPage>
	);
}

function ListedProviderRow(props: {
	provider: ProviderStatus;
	busy: boolean;
	onSignIn: () => void;
	onApiKey: () => void;
}) {
	const { rowProps, primaryProps, sideProps } = useSettingsListRow(props.provider.id);
	return (
		<li {...rowProps} className="[&>div]:last:border-b-0">
			<ProviderRow {...props} actions={{ primary: primaryProps, side: sideProps }} />
		</li>
	);
}

function SignedInRow({
	provider,
	busy,
	onSignOut,
}: {
	provider: ProviderStatus;
	busy: boolean;
	onSignOut: () => void;
}) {
	const t = useT();
	const { rowProps, primaryProps } = useSettingsListRow(provider.id);
	const kind = t(AUTH_KIND_LABEL[provider.kind ?? "other"]);

	return (
		<li
			{...(provider.canLogout ? rowProps : {})}
			data-testid="provider-row"
			data-provider={provider.id}
			data-configured="true"
			data-kind={provider.kind}
			className={SETTINGS_LIST_ROW}
		>
			<span className="flex min-w-0 flex-1 flex-col gap-2 px-4">
				<span className="tr-text-ui text-text-default">{provider.name}</span>
				<span className="text-text-muted tr-text-metadata">
					{provider.detail
						? t("settings.providers.kindDetail", { kind, detail: provider.detail })
						: kind}
				</span>
				{provider.canLogout ? null : (
					<span
						data-testid="provider-managed"
						className="flex items-start gap-4 text-text-muted tr-text-metadata"
					>
						<Lock aria-hidden className="mt-2 size-12 shrink-0" />
						{provider.kind === "central"
							? t("settings.providers.managedCentral")
							: t("settings.providers.managedOutside")}
					</span>
				)}
			</span>
			{provider.canLogout ? (
				<Button
					variant="soft-primary"
					size="m"
					iconLeft={LogOut}
					{...primaryProps}
					data-testid="provider-signout"
					data-provider={provider.id}
					disabled={busy}
					onClick={onSignOut}
				>
					{t("settings.providers.signOut")}
				</Button>
			) : null}
		</li>
	);
}
