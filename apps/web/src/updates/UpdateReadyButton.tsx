import { RiDownloadCloud2Line as DownloadCloud } from "@remixicon/react";
import { Button } from "../components/ui/button";
import type { UpdatesController } from "./useUpdates";

export function UpdateReadyButton({
	updates,
	onOpen,
}: {
	updates: UpdatesController;
	onOpen(): void;
}) {
	const hostUpdate = updates.source === "host";
	const hostStatus = updates.source === "host" ? updates.state.status : undefined;
	const hostRequestFailed = updates.source === "host" && updates.requestFailed;
	const nativeState = updates.source === "native" ? updates.state : null;
	const nativeNeedsAttention = updates.source === "native" && updates.requestError !== null;
	const nativeActionable =
		nativeNeedsAttention ||
		nativeState?.status === "available" ||
		nativeState?.status === "downloading" ||
		nativeState?.status === "preparing" ||
		nativeState?.status === "ready" ||
		nativeState?.status === "installing" ||
		nativeState?.status === "error";
	if (!nativeActionable && !hostUpdate) return null;

	const availableVersion = updates.state.availableVersion;
	let label = "Update needs attention";
	let ariaLabel = availableVersion
		? `ThinkRail ${availableVersion} update needs attention`
		: "A ThinkRail update needs attention";
	if (hostUpdate) {
		if (hostRequestFailed || hostStatus === "failed") {
			label = "Update failed";
			ariaLabel = "The ThinkRail host update failed";
		} else if (hostStatus === "running") {
			label = "Updating host";
			ariaLabel = availableVersion
				? `Updating the ThinkRail host to ${availableVersion}`
				: "Updating the ThinkRail host";
		} else if (hostStatus === "succeeded") {
			label = "Restart host";
			ariaLabel = availableVersion
				? `Restart the ThinkRail host to use ${availableVersion}`
				: "Restart the ThinkRail host to use the update";
		} else {
			label = "Update available";
			ariaLabel = availableVersion
				? `ThinkRail ${availableVersion} is available`
				: "A ThinkRail update is available";
		}
	} else if (!nativeNeedsAttention && nativeState) {
		switch (nativeState.status) {
			case "available":
				label = "Update available";
				ariaLabel = availableVersion
					? `ThinkRail ${availableVersion} is available to download`
					: "A ThinkRail update is available to download";
				break;
			case "downloading":
				label =
					typeof nativeState.progress === "number"
						? `Downloading ${Math.round(nativeState.progress)}%`
						: "Downloading update";
				ariaLabel = label;
				break;
			case "preparing":
				label = "Preparing update";
				ariaLabel = label;
				break;
			case "ready":
				label = "Update ready";
				ariaLabel = availableVersion
					? `ThinkRail ${availableVersion} is ready to install`
					: "An update is ready to install";
				break;
			case "installing":
				label = "Installing update";
				ariaLabel = label;
				break;
		}
	}

	return (
		<Button
			variant="ghost"
			size="sm"
			data-testid="update-ready"
			data-source={updates.source}
			data-status={nativeState?.status ?? hostStatus ?? (hostUpdate ? "legacy" : undefined)}
			aria-label={ariaLabel}
			onClick={onOpen}
			className="text-primary"
		>
			<DownloadCloud className="size-14" />
			<span className="hidden md:inline">{label}</span>
		</Button>
	);
}
