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
	const hostAvailable = updates.source === "host";
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
	if (!nativeActionable && !hostAvailable) return null;

	const availableVersion = updates.state.availableVersion;
	let label = "Update needs attention";
	let ariaLabel = availableVersion
		? `ThinkRail ${availableVersion} update needs attention`
		: "A ThinkRail update needs attention";
	if (hostAvailable) {
		label = "Update available";
		ariaLabel = availableVersion
			? `ThinkRail ${availableVersion} is available`
			: "A ThinkRail update is available";
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
			data-status={nativeState?.status}
			aria-label={ariaLabel}
			onClick={onOpen}
			className="text-primary"
		>
			<DownloadCloud className="size-14" />
			<span className="hidden md:inline">{label}</span>
		</Button>
	);
}
