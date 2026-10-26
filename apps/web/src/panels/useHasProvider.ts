import { useEffect, useState } from "react";
import { useAppStore } from "@/store";
import { getTransport } from "@/transport";

export function useHasProvider(): boolean | null {
	const [hasProvider, setHasProvider] = useState<boolean | null>(null);
	const settingsOpen = useAppStore((s) => s.settingsOpen);
	const providerVersion = useAppStore((s) => s.providerVersion);

	useEffect(() => {
		if (settingsOpen) return;
		let cancelled = false;
		getTransport()
			.request("provider.status", {})
			.then((report) => {
				if (!cancelled) setHasProvider(report.providers.some((p) => p.configured));
			})
			.catch(() => {
				if (!cancelled) setHasProvider(true);
			});
		return () => {
			cancelled = true;
		};
	}, [settingsOpen, providerVersion]);

	return hasProvider;
}
