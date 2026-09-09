import { RiDownloadCloud2Line as DownloadCloud } from "@remixicon/react";
import { Button } from "../components/ui/button";
import { useNativeUpdates } from "./useNativeUpdates";

interface NativeUpdateReadyButtonViewProps {
	version: string | null;
	onOpen(): void;
}

export function NativeUpdateReadyButtonView({ version, onOpen }: NativeUpdateReadyButtonViewProps) {
	return (
		<Button
			variant="ghost"
			size="sm"
			data-testid="native-update-ready"
			aria-label={
				version ? `ThinkRail ${version} is ready to install` : "An update is ready to install"
			}
			onClick={onOpen}
			className="text-primary"
		>
			<DownloadCloud className="size-14" />
			<span className="hidden md:inline">Update ready</span>
		</Button>
	);
}

export function NativeUpdateReadyButton({ onOpen }: { onOpen(): void }) {
	const updates = useNativeUpdates();
	if (!updates?.presentation.ready) return null;
	return (
		<NativeUpdateReadyButtonView version={updates.presentation.availableVersion} onOpen={onOpen} />
	);
}
