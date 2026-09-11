import { RiDownloadCloud2Line as DownloadCloud } from "@remixicon/react";
import type { NativeUpdateState } from "@thinkrail/contracts";
import { Button } from "../components/ui/button";

export function NativeUpdateReadyButton({
	state,
	onOpen,
}: {
	state: NativeUpdateState | null;
	onOpen(): void;
}) {
	if (state?.status !== "ready") return null;
	return (
		<Button
			variant="ghost"
			size="sm"
			data-testid="native-update-ready"
			aria-label={
				state.availableVersion
					? `ThinkRail ${state.availableVersion} is ready to install`
					: "An update is ready to install"
			}
			onClick={onOpen}
			className="text-primary"
		>
			<DownloadCloud className="size-14" />
			<span className="hidden md:inline">Update ready</span>
		</Button>
	);
}
