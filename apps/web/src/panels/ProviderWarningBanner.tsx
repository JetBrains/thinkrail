import { TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
			className="mt-lg flex w-full max-w-[560px] items-center gap-sm rounded-[var(--radius-sm)] border border-border-default border-l-[3px] border-l-feedback-warning bg-feedback-warning-subtle px-md py-sm text-left"
		>
			<TriangleAlert className="size-4 shrink-0 text-feedback-warning" />
			<span className="min-w-0 flex-1 tr-text-reading text-text-default">
				No model provider connected — the agent can't run.
			</span>
			<Button
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
