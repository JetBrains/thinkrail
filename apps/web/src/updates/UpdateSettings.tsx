import {
	RiDownloadCloud2Line as DownloadCloud,
	RiRefreshLine as Refresh,
	RiRestartLine as Restart,
} from "@remixicon/react";
import type { HostUpdateNotice, NativeUpdateState } from "@thinkrail/contracts";
import { T, useT } from "@thinkrail/locales/react";
import { Button, type ButtonIcon } from "@thinkrail/ui/button";
import {
	SETTINGS_ROWS,
	SettingsGroup,
	SettingsNotice,
	SettingsPage,
	SettingsRow,
} from "../settingsKit";
import { installFailureCopy } from "./installCopy";
import type { NativeUpdateAction, UpdatesController } from "./useUpdates";

interface UpdateSettingsProps {
	updates: UpdatesController;
}

type Translate = ReturnType<typeof useT>;

function nativeStatusCopy(
	t: Translate,
	state: NativeUpdateState | null,
): { title: string; detail: string } {
	switch (state?.status) {
		case "disabled":
			return {
				title: t("updates.native.disabled.title"),
				detail: t("updates.native.disabled.detail"),
			};
		case "idle":
			return {
				title: t("updates.native.idle.title"),
				detail: t("updates.native.idle.detail"),
			};
		case "checking":
			return {
				title: t("updates.native.checking.title"),
				detail: t("updates.native.checking.detail"),
			};
		case "available":
			return {
				title: state.availableVersion
					? t("updates.native.available.titleVersion", { version: state.availableVersion })
					: t("updates.native.available.title"),
				detail: t("updates.native.available.detail"),
			};
		case "downloading":
			return {
				title: state.availableVersion
					? t("updates.native.downloading.titleVersion", { version: state.availableVersion })
					: t("updates.native.downloading.title"),
				detail: t("updates.native.downloading.detail"),
			};
		case "preparing":
			return {
				title: t("updates.native.preparing.title"),
				detail: t("updates.native.preparing.detail"),
			};
		case "ready":
			return {
				title: state.availableVersion
					? t("updates.native.ready.titleVersion", { version: state.availableVersion })
					: t("updates.native.ready.title"),
				detail: t("updates.native.ready.detail"),
			};
		case "installing":
			return {
				title: t("updates.native.installing.title"),
				detail: t("updates.native.installing.detail"),
			};
		case "error":
			return {
				title: t("updates.native.error.title"),
				detail: t("updates.native.error.detail"),
			};
		default:
			return {
				title: t("updates.native.loading.title"),
				detail: t("updates.native.loading.detail"),
			};
	}
}

function hostNoticeCopy(
	t: Translate,
	state: HostUpdateNotice,
	requestFailed: boolean,
): { title: string; detail: string } {
	if (requestFailed || state.status === "failed") {
		return {
			title: t("updates.host.failed.title"),
			detail: t("updates.host.failed.detail"),
		};
	}
	switch (state.status) {
		case "running":
			return {
				title: t("updates.host.running.title", { version: state.availableVersion }),
				detail: t("updates.host.running.detail"),
			};
		case "succeeded":
			return {
				title: t("updates.host.succeeded.title", { version: state.availableVersion }),
				detail: t("updates.host.succeeded.detail"),
			};
		default:
			return {
				title: t("updates.host.available.title", { version: state.availableVersion }),
				detail:
					state.status === "available"
						? t("updates.host.available.detail")
						: t("updates.host.legacy.detail"),
			};
	}
}

interface UpdateAction {
	testId: string;
	label: string;
	icon: ButtonIcon;
	primary?: boolean;
	disabled?: boolean;
	onClick: () => void;
}

function publicChannel(channel: string | undefined): string | undefined {
	return channel === "canary" ? "nightly" : channel;
}

export function UpdateSettings({ updates }: UpdateSettingsProps) {
	const t = useT();
	const nativeState = updates.source === "native" ? updates.state : null;
	const hostNotice = updates.source === "host" ? updates.state : null;
	const nativeRequestError = updates.source === "native" ? updates.requestError : null;
	const hostRequestFailed = updates.source === "host" && updates.requestFailed;
	const nativeStatus = nativeState?.status ?? "loading";
	const hostStatus = hostNotice?.status;
	const error = nativeRequestError?.message ?? nativeState?.error ?? null;
	const lastInstall = nativeState?.lastInstall ?? null;
	const installFailure =
		lastInstall && lastInstall.outcome !== "installed" ? installFailureCopy(t, lastInstall) : null;
	const failedAction: NativeUpdateAction | null =
		nativeRequestError?.action ?? nativeState?.failedPhase ?? null;
	const copy = hostNotice
		? hostNoticeCopy(t, hostNotice, hostRequestFailed)
		: nativeStatusCopy(t, nativeState);
	const ready = nativeState?.status === "ready";
	const nativeAvailable = nativeState?.status === "available";
	const hostAvailable =
		hostNotice !== null && (hostStatus === undefined || hostStatus === "available");
	const hostRunning = hostStatus === "running";
	const hostSucceeded = hostStatus === "succeeded";
	const hostFailed = hostStatus === "failed" || hostRequestFailed;
	const checking = nativeState?.status === "checking";
	const downloading = nativeState?.status === "downloading";
	const preparing = nativeState?.status === "preparing";
	const progress =
		downloading &&
		typeof nativeState?.progress === "number" &&
		Number.isFinite(nativeState.progress)
			? Math.min(100, Math.max(0, nativeState.progress))
			: null;
	const progressLabel = downloading
		? progress === null
			? t("updates.progress.downloading")
			: t("updates.progress.downloadingPercent", { percent: Math.round(progress) })
		: preparing
			? t("updates.progress.preparing")
			: hostRunning
				? t("updates.progress.running")
				: null;
	const currentVersion = hostNotice?.currentVersion ?? nativeState?.version;
	const channel = hostNotice?.channel ?? publicChannel(nativeState?.channel);
	const availableVersion = hostNotice?.availableVersion ?? nativeState?.availableVersion;
	const retry =
		updates.source === "native" && failedAction
			? failedAction === "check"
				? updates.checkForUpdates
				: failedAction === "download"
					? updates.downloadUpdate
					: updates.restartToUpdate
			: null;
	const showHostManualGuidance =
		hostNotice !== null &&
		(hostStatus === undefined || hostStatus === "failed" || hostRequestFailed);

	const actions: UpdateAction[] = [];
	if (updates.source === "native") {
		if (updates.state.status === "idle" || checking) {
			actions.push({
				testId: "update-check",
				label: checking ? t("updates.action.checking") : t("updates.action.check"),
				icon: Refresh,
				disabled: checking,
				onClick: updates.checkForUpdates,
			});
		}
		if (retry) {
			actions.push({
				testId: "update-retry",
				label: t("common.retry"),
				icon: Refresh,
				onClick: retry,
			});
		}
		if (nativeAvailable && failedAction !== "download") {
			actions.push({
				testId: "update-download",
				label: t("updates.action.download"),
				icon: DownloadCloud,
				primary: true,
				onClick: updates.downloadUpdate,
			});
		}
		if (ready && failedAction !== "install") {
			actions.push({
				testId: "update-restart",
				label: t("updates.action.installRestart"),
				icon: Restart,
				primary: true,
				onClick: updates.restartToUpdate,
			});
		}
	} else if (updates.canRun && (hostAvailable || hostFailed)) {
		actions.push(
			hostFailed
				? {
						testId: "update-retry",
						label: t("common.retry"),
						icon: Refresh,
						onClick: updates.runUpdate,
					}
				: {
						testId: "update-run-host",
						label: t("updates.action.run"),
						icon: DownloadCloud,
						primary: true,
						onClick: updates.runUpdate,
					},
		);
	}
	const [first, ...rest] = actions.map((action) => (
		<Button
			key={action.testId}
			variant={action.primary ? "primary" : "outline"}
			size="m"
			iconLeft={action.icon}
			tabIndex={0}
			disabled={action.disabled}
			data-testid={action.testId}
			onClick={action.onClick}
		>
			{action.label}
		</Button>
	));

	return (
		<SettingsPage
			title={t("settings.nav.updates")}
			description={
				updates.source === "native"
					? t("updates.settings.nativeDescription")
					: t("updates.settings.hostDescription")
			}
			testId="settings-updates"
		>
			<SettingsGroup title={t("updates.settings.title")}>
				<div
					data-testid="update-status"
					data-source={updates.source}
					data-status={updates.source === "native" ? nativeStatus : (hostStatus ?? "legacy")}
					className={SETTINGS_ROWS}
				>
					<SettingsRow
						settingId="software-updates"
						label={nativeRequestError ? t("updates.requestFailed.title") : copy.title}
						description={
							<div className="flex flex-col gap-4">
								<p>{nativeRequestError ? t("updates.requestFailed.detail") : copy.detail}</p>
								{progressLabel ? (
									<div className="flex flex-col gap-4">
										<progress
											max={100}
											{...(downloading && progress !== null ? { value: progress } : {})}
											aria-label={progressLabel}
											className="h-4 w-full accent-primary"
										/>
										<span>{progressLabel}</span>
									</div>
								) : null}
								{error ? (
									<p
										data-testid="update-error"
										role="alert"
										className="text-feedback-error tr-text-ui"
									>
										{error}
									</p>
								) : null}
								<div className="flex flex-wrap gap-x-8">
									<span data-testid="update-version">
										{currentVersion && channel
											? updates.source === "host"
												? t("updates.version.current", { version: currentVersion, channel })
												: t("updates.version.native", { version: currentVersion, channel })
											: t("updates.version.unavailable")}
									</span>
									{availableVersion ? (
										<span>{t("updates.version.available", { version: availableVersion })}</span>
									) : null}
								</div>
								{ready ? <p>{t("updates.settings.deferral")}</p> : null}
							</div>
						}
						control={first}
						sides={rest.length > 0 ? rest : undefined}
					/>
					{installFailure ? (
						<div className="py-12">
							<SettingsNotice variant="error" testId="update-last-install">
								<p className="tr-title-compact">
									{t("updates.result.settingsCallout", { cause: installFailure.cause })}
								</p>
								<p className="text-text-muted tr-text-metadata">{installFailure.advice}</p>
							</SettingsNotice>
						</div>
					) : null}
					{showHostManualGuidance ? (
						<div className="py-12">
							<SettingsNotice variant="neutral" testId="update-command-guidance">
								<T
									i18nKey="updates.manualGuidance"
									components={[<code key="command" className="tr-code-text text-primary" />]}
								/>
							</SettingsNotice>
						</div>
					) : null}
					{hostSucceeded ? (
						<div className="py-12">
							<SettingsNotice variant="info" testId="update-host-restart-guidance">
								{t("updates.restartGuidance", { version: availableVersion })}
							</SettingsNotice>
						</div>
					) : null}
				</div>
			</SettingsGroup>
		</SettingsPage>
	);
}
