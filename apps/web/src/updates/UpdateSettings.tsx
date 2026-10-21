import {
	RiDownloadCloud2Line as DownloadCloud,
	RiRefreshLine as Refresh,
	RiRestartLine as Restart,
} from "@remixicon/react";
import type { HostUpdateNotice, NativeUpdateState } from "@thinkrail/contracts";
import { T, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
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
	const installing = nativeState?.status === "installing";
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
	const toneClass =
		error || hostFailed
			? "text-feedback-error"
			: ready || nativeAvailable || hostAvailable || hostSucceeded
				? "text-primary"
				: checking || downloading || preparing || installing || hostRunning
					? "text-feedback-info"
					: "text-text-muted";
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

	return (
		<section data-testid="settings-updates" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">{t("updates.settings.title")}</h3>
				<p className="text-text-muted tr-text-metadata">
					{updates.source === "native"
						? t("updates.settings.nativeDescription")
						: t("updates.settings.hostDescription")}
				</p>
			</div>

			<div
				data-testid="update-status"
				data-source={updates.source}
				data-status={updates.source === "native" ? nativeStatus : (hostStatus ?? "legacy")}
				className="flex flex-col gap-12 rounded-sm border border-border-default bg-control-bg p-12"
			>
				<div className="flex items-start gap-8">
					<DownloadCloud aria-hidden="true" className={`mt-2 size-16 shrink-0 ${toneClass}`} />
					<div className="min-w-0 flex-1">
						<p className="tr-title-compact text-text-default">
							{nativeRequestError ? t("updates.requestFailed.title") : copy.title}
						</p>
						<p className="text-text-muted tr-text-metadata">
							{nativeRequestError ? t("updates.requestFailed.detail") : copy.detail}
						</p>
					</div>
				</div>

				{progressLabel ? (
					<div className="flex flex-col gap-4">
						<progress
							max={100}
							{...(downloading && progress !== null ? { value: progress } : {})}
							aria-label={progressLabel}
							className="h-4 w-full accent-primary"
						/>
						<span className="text-text-muted tr-text-metadata">{progressLabel}</span>
					</div>
				) : null}

				{error ? (
					<p data-testid="update-error" role="alert" className="text-feedback-error tr-text-ui">
						{error}
					</p>
				) : null}

				{showHostManualGuidance ? (
					<p
						data-testid="update-command-guidance"
						className="rounded-sm border border-border-default bg-container-elevated-bg p-8 text-text-default tr-text-ui"
					>
						<T
							i18nKey="updates.manualGuidance"
							components={[<code key="command" className="tr-code-text text-primary" />]}
						/>
					</p>
				) : null}

				{hostSucceeded ? (
					<p
						data-testid="update-host-restart-guidance"
						className="rounded-sm border border-border-default bg-container-elevated-bg p-8 text-text-default tr-text-ui"
					>
						{t("updates.restartGuidance", { version: availableVersion })}
					</p>
				) : null}

				<div className="flex flex-wrap items-center justify-between gap-8 border-border-default border-t pt-8">
					<span data-testid="update-version" className="text-text-muted tr-text-metadata">
						{currentVersion && channel
							? updates.source === "host"
								? t("updates.version.current", { version: currentVersion, channel })
								: t("updates.version.native", { version: currentVersion, channel })
							: t("updates.version.unavailable")}
					</span>
					{availableVersion ? (
						<span className="text-text-muted tr-text-metadata">
							{t("updates.version.available", { version: availableVersion })}
						</span>
					) : null}
				</div>
			</div>

			{updates.source === "native" ? (
				<div className="flex flex-wrap justify-end gap-8">
					{updates.state.status === "idle" || checking ? (
						<Button
							variant="outline"
							data-testid="update-check"
							disabled={checking}
							onClick={updates.checkForUpdates}
						>
							<Refresh className="size-14" />
							{checking ? t("updates.action.checking") : t("updates.action.check")}
						</Button>
					) : null}
					{retry ? (
						<Button variant="outline" data-testid="update-retry" onClick={retry}>
							<Refresh className="size-14" />
							{t("common.retry")}
						</Button>
					) : null}
					{nativeAvailable && failedAction !== "download" ? (
						<Button data-testid="update-download" onClick={updates.downloadUpdate}>
							<DownloadCloud className="size-14" />
							{t("updates.action.download")}
						</Button>
					) : null}
					{ready && failedAction !== "install" ? (
						<Button data-testid="update-restart" onClick={updates.restartToUpdate}>
							<Restart className="size-14" />
							{t("updates.action.installRestart")}
						</Button>
					) : null}
				</div>
			) : updates.canRun && (hostAvailable || hostFailed) ? (
				<div className="flex flex-wrap justify-end gap-8">
					<Button
						{...(hostFailed ? { variant: "outline" as const } : {})}
						data-testid={hostFailed ? "update-retry" : "update-run-host"}
						onClick={updates.runUpdate}
					>
						{hostFailed ? <Refresh className="size-14" /> : <DownloadCloud className="size-14" />}
						{hostFailed ? t("common.retry") : t("updates.action.run")}
					</Button>
				</div>
			) : null}

			{ready ? (
				<p className="text-text-muted tr-text-metadata">{t("updates.settings.deferral")}</p>
			) : null}
		</section>
	);
}
