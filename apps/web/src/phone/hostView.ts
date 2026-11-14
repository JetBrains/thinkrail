import type { RemoteDeviceAccess, ServerWelcome } from "@thinkrail/contracts";
import type {
	DeviceWireClient,
	RemoteSessionsController,
	RemoteSessionsSnapshot,
} from "@thinkrail/remote-client";
import { useSyncExternalStore } from "react";

export function useHostClient(
	controller: RemoteSessionsController,
	hostKey: string,
): DeviceWireClient | null {
	const read = () => controller.clientFor(hostKey);
	return useSyncExternalStore(controller.subscribe, read, read);
}

export function useHostAccess(
	controller: RemoteSessionsController,
	hostKey: string,
): RemoteDeviceAccess {
	const read = () => controller.accessFor(hostKey);
	return useSyncExternalStore(controller.subscribe, read, read);
}

export function useHostWelcome(
	controller: RemoteSessionsController,
	hostKey: string,
): ServerWelcome | null {
	const read = () => controller.welcomeFor(hostKey);
	return useSyncExternalStore(controller.subscribe, read, read);
}

export function useConnectedHosts(
	controller: RemoteSessionsController,
	hostKeys: readonly string[],
): string {
	const keys = hostKeys.join("\t");
	const read = () =>
		keys
			.split("\t")
			.filter((hostKey) => hostKey && controller.clientFor(hostKey))
			.join("\t");
	return useSyncExternalStore(controller.subscribe, read, read);
}

/** Everything the controller tracks, re-read on each change it notifies, for a screen that spans hosts. */
export function useRemoteSessions(controller: RemoteSessionsController): RemoteSessionsSnapshot {
	return useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
}
