import { RiAlertLine as TriangleAlert } from "@remixicon/react";
import { Button } from "@thinkrail/ui/button";
import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "@/store";
import { getTransport } from "@/transport";

export function ProviderWarningBanner() {
	const [hasProvider, setHasProvider] = useState<boolean | null>(null);
	const settingsOpen = useAppStore((s) => s.settingsOpen);

	const check = useCallback(async () => {
		try {
			const report = await getTransport().request("provider.status", {});
			setHasProvider(report.providers.some((p) => p.configured));
		} catch {
			setHasProvider(true);
		}
	}, []);

	useEffect(() => {
		if (!settingsOpen) void check();
	}, [check, settingsOpen]);

	if (hasProvider !== false) return null;

	return (
		<div
			data-testid="welcome-provider-warning"
			className="mt-16 flex w-full max-w-[560px] items-center gap-8 rounded-sm border border-feedback-warning-muted bg-container-elevated-bg px-12 py-8 text-left"
		>
			<TriangleAlert className="-mt-2 size-14 shrink-0 text-feedback-warning" />
			<span className="min-w-0 flex-1 tr-text-ui text-text-default">
				No model provider connected — the agent can't run.
			</span>
			<Button
				variant="outline"
				size="sm"
				data-testid="welcome-connect-provider"
				onClick={() => useAppStore.getState().openSettings("providers")}
				className="shrink-0"
			>
				Connect a provider
			</Button>
		</div>
	);
}
