import { RiDownloadCloud2Line as DownloadCloud } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import type { UpdatesController } from "./useUpdates";

export function UpdateReadyButton({
	updates,
	onOpen,
}: {
	updates: UpdatesController;
	onOpen(): void;
}) {
	const t = useT();
	const hostUpdate = updates.source === "host";
	const hostStatus = updates.source === "host" ? updates.state.status : undefined;
	const hostRequestFailed = updates.source === "host" && updates.requestFailed;
	const nativeState = updates.source === "native" ? updates.state : null;
	const nativeNeedsAttention = updates.source === "native" && updates.requestError !== null;
	const lastInstall = nativeState?.lastInstall ?? null;
	const installFailed = lastInstall !== null && lastInstall.outcome !== "installed";
	const nativeActionable =
		nativeNeedsAttention ||
		installFailed ||
		nativeState?.status === "available" ||
		nativeState?.status === "downloading" ||
		nativeState?.status === "preparing" ||
		nativeState?.status === "ready" ||
		nativeState?.status === "installing" ||
		nativeState?.status === "error";
	if (!nativeActionable && !hostUpdate) return null;

	const availableVersion = updates.state.availableVersion;
	let label = t("updates.button.attention");
	let ariaLabel = availableVersion
		? t("updates.button.attentionVersionLabel", { version: availableVersion })
		: t("updates.button.attentionLabel");
	if (hostUpdate) {
		if (hostRequestFailed || hostStatus === "failed") {
			label = t("updates.button.failed");
			ariaLabel = t("updates.button.failedLabel");
		} else if (hostStatus === "running") {
			label = t("updates.button.updatingHost");
			ariaLabel = availableVersion
				? t("updates.button.updatingHostVersionLabel", { version: availableVersion })
				: t("updates.button.updatingHostLabel");
		} else if (hostStatus === "succeeded") {
			label = t("updates.button.restartHost");
			ariaLabel = availableVersion
				? t("updates.button.restartHostVersionLabel", { version: availableVersion })
				: t("updates.button.restartHostLabel");
		} else {
			label = t("updates.button.available");
			ariaLabel = availableVersion
				? t("updates.button.hostAvailableVersionLabel", { version: availableVersion })
				: t("updates.button.hostAvailableLabel");
		}
	} else if (installFailed) {
		label = t("updates.button.installFailed");
		ariaLabel = t("updates.button.installFailedLabel");
	} else if (!nativeNeedsAttention && nativeState) {
		switch (nativeState.status) {
			case "available":
				label = t("updates.button.available");
				ariaLabel = availableVersion
					? t("updates.button.nativeAvailableVersionLabel", { version: availableVersion })
					: t("updates.button.nativeAvailableLabel");
				break;
			case "downloading":
				label =
					typeof nativeState.progress === "number"
						? t("updates.button.downloadingPercent", {
								percent: Math.round(nativeState.progress),
							})
						: t("updates.button.downloading");
				ariaLabel = label;
				break;
			case "preparing":
				label = t("updates.button.preparing");
				ariaLabel = label;
				break;
			case "ready":
				label = t("updates.button.ready");
				ariaLabel = availableVersion
					? t("updates.button.readyVersionLabel", { version: availableVersion })
					: t("updates.button.readyLabel");
				break;
			case "installing":
				label = t("updates.button.installing");
				ariaLabel = label;
				break;
		}
	}

	return (
		<Button
			variant="soft-primary"
			size="m"
			iconLeft={DownloadCloud}
			data-testid="update-ready"
			data-source={updates.source}
			data-status={nativeState?.status ?? hostStatus ?? (hostUpdate ? "legacy" : undefined)}
			aria-label={ariaLabel}
			onClick={onOpen}
		>
			<span className="hidden md:inline">{label}</span>
		</Button>
	);
}
