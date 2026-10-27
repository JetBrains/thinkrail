import { RiAlertLine as TriangleAlert } from "@remixicon/react";
import type { ProviderStatus } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { ConnectProviderDialog } from "./ConnectProviderDialog";

export function ProviderWarningBanner({
	hasProvider,
	onConnected,
}: {
	hasProvider: boolean | null;
	onConnected?: (provider: ProviderStatus) => void;
}) {
	const t = useT();
	const [connecting, setConnecting] = useState(false);

	return (
		<>
			{hasProvider === false ? (
				<div
					data-testid="welcome-provider-warning"
					className="mt-16 flex w-full max-w-[560px] items-center gap-8 rounded-sm border border-border-default border-l-[3px] border-l-feedback-warning bg-feedback-warning-subtle px-12 py-8 text-left"
				>
					<TriangleAlert className="size-16 shrink-0 text-feedback-warning" />
					<span className="min-w-0 flex-1 tr-text-reading text-text-default">
						{t("panels.providerWarning.message")}
					</span>
					<Button
						size="sm"
						data-testid="welcome-connect-provider"
						onClick={() => setConnecting(true)}
						className="shrink-0"
					>
						{t("panels.providerWarning.connect")}
					</Button>
				</div>
			) : null}
			{connecting ? (
				<ConnectProviderDialog
					onClose={() => setConnecting(false)}
					{...(onConnected ? { onConnected } : {})}
				/>
			) : null}
		</>
	);
}
