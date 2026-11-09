import type { DeviceWireClient } from "@thinkrail/remote-client";
import { useEffect, useSyncExternalStore } from "react";
import { useAppStore } from "../store";
import { mountRemoteSession } from "../transport";

let mounted: { hostKey: string; client: DeviceWireClient } | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function mountedHostKey(): string | null {
	return mounted?.hostKey ?? null;
}

export function mountStoreHost(hostKey: string, client: DeviceWireClient): void {
	if (mounted?.hostKey === hostKey && mounted.client === client) return;
	mounted = { hostKey, client };
	mountRemoteSession(client, hostKey);
	for (const listener of listeners) listener();
}

export function useStoreHost(
	hostKey: string,
	client: DeviceWireClient | null | undefined,
): boolean {
	useEffect(() => {
		if (client) mountStoreHost(hostKey, client);
	}, [hostKey, client]);
	const current = useSyncExternalStore(subscribe, mountedHostKey, mountedHostKey);
	const welcomed = useAppStore((state) => state.protocolVersion !== null);
	return client != null && current === hostKey && welcomed;
}
