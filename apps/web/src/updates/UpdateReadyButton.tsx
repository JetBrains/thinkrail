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
	const nativeReady = updates.source === "native" && updates.state?.status === "ready";
	const hostAvailable = updates.source === "host";
	if (!nativeReady && !hostAvailable) return null;
	const availableVersion = updates.state?.availableVersion;
	const ariaLabel = hostAvailable
		? availableVersion
			? `ThinkRail ${availableVersion} is available`
			: "A ThinkRail update is available"
		: availableVersion
			? `ThinkRail ${availableVersion} is ready to install`
			: "An update is ready to install";

	return (
		<Button
			variant="ghost"
			size="sm"
			data-testid="update-ready"
			data-source={updates.source}
			aria-label={ariaLabel}
			onClick={onOpen}
			className="text-primary"
		>
			<DownloadCloud className="size-14" />
			<span className="hidden md:inline">
				{hostAvailable ? "Update available" : "Update ready"}
			</span>
		</Button>
	);
}
