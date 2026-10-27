import { useEffect } from "react";
import { type ProviderStatusSnapshot, useAppStore } from "@/store";
import { getTransport } from "@/transport";

let inflight: { version: number; read: Promise<void> } | null = null;

export function refreshProviderStatus(): Promise<void> {
	const version = useAppStore.getState().providerStatusVersion;
	if (inflight?.version === version) return inflight.read;
	const read = getTransport()
		.request("provider.status", {})
		.then(
			(report) => useAppStore.getState().installProviderStatus(version, report),
			() => useAppStore.getState().installProviderStatus(version, null),
		)
		.finally(() => {
			if (inflight?.read === read) inflight = null;
		});
	inflight = { version, read };
	return read;
}

export function reloadProviderStatus(): Promise<void> {
	useAppStore.getState().invalidateProviderStatus();
	return refreshProviderStatus();
}

export function useProviderStatus(): ProviderStatusSnapshot & { refreshing: boolean } {
	const version = useAppStore((s) => s.providerStatusVersion);
	const status = useAppStore((s) => s.providerStatus);
	const stale = status.version !== version;

	useEffect(() => {
		if (stale) void refreshProviderStatus();
	}, [stale, version]);

	return { ...status, refreshing: stale };
}

export function useHasProvider(): boolean | null {
	const { report, failed } = useProviderStatus();
	if (report) return report.providers.some((p) => p.configured);
	return failed ? true : null;
}
