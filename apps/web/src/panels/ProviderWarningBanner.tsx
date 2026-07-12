import { TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store";
import { getTransport } from "@/transport";

/**
 * The Welcome screen's provider guard: a slim gold banner shown **only when no provider is connected** (the
 * agent can't run), with a CTA that opens Settings → Providers. Replaces the old always-on status strip —
 * when a provider is connected this renders nothing. Re-checks when the settings dialog closes, so it
 * disappears the moment the user connects a provider in there.
 */
export function ProviderWarningBanner() {
	const [hasProvider, setHasProvider] = useState<boolean | null>(null);
	const settingsOpen = useAppStore((s) => s.settingsOpen);

	const check = useCallback(async () => {
		try {
			const report = await getTransport().request("provider.status", {});
			setHasProvider(report.providers.some((p) => p.configured));
		} catch {
			// Offline ≠ "no provider" — don't nag on a transport error; assume configured.
			setHasProvider(true);
		}
	}, []);

	// Check on mount, and re-check whenever settings is *closed* — the user may have just connected a provider
	// in there. (Reading `settingsOpen` in the body also keeps it a real dependency, not a bare trigger.)
	useEffect(() => {
		if (!settingsOpen) void check();
	}, [check, settingsOpen]);

	// Unknown (still loading) or a provider is connected → nothing to warn about.
	if (hasProvider !== false) return null;

	return (
		<div
			data-testid="welcome-provider-warning"
			className="mt-lg flex w-full max-w-[560px] items-center gap-sm rounded-[var(--radius-md)] border border-border2 border-l-[3px] border-l-[var(--gold)] bg-[var(--gold-tint)] px-md py-sm text-left"
		>
			<TriangleAlert className="size-4 shrink-0 text-gold" />
			<span className="min-w-0 flex-1 text-sm text-text">
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
