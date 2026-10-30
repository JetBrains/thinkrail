import { parsePairingUri } from "@thinkrail/contracts";
import { connectRemoteProject, type RemoteConnection } from "./deviceConnector";

export type RemoteConnectionState =
	| { status: "idle" }
	| { status: "connecting"; link: string }
	| { status: "connected"; connection: RemoteConnection }
	| { status: "error"; message: string };

export interface RemoteConnectionController {
	getState(): RemoteConnectionState;
	subscribe(listener: () => void): () => void;
	connect(link: string, label: string): Promise<void>;
	reset(): void;
}

type Connector = (link: string, options: { label: string }) => Promise<RemoteConnection>;

/**
 * Drives the "add a project by link" lifecycle: validate the pairing link, connect through the device
 * connector, and track idle → connecting → connected | error for the UI. The connector is injected (default
 * `connectRemoteProject`) so the controller is unit-tested without a browser/relay. Mounting the connected
 * client into the app's store/transport is a separate, larger step (the store leans on the WS transport's
 * file/blob + reconnect surface a DataChannel does not yet provide).
 */
export function createRemoteConnectionController(
	connector: Connector = connectRemoteProject,
): RemoteConnectionController {
	let state: RemoteConnectionState = { status: "idle" };
	const listeners = new Set<() => void>();
	const set = (next: RemoteConnectionState): void => {
		state = next;
		for (const listener of listeners) listener();
	};

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		async connect(link, label) {
			if (!parsePairingUri(link)) {
				set({ status: "error", message: "That is not a valid ThinkRail pairing link." });
				return;
			}
			set({ status: "connecting", link });
			try {
				const connection = await connector(link, { label });
				set({ status: "connected", connection });
			} catch (error) {
				set({ status: "error", message: error instanceof Error ? error.message : String(error) });
			}
		},
		reset() {
			set({ status: "idle" });
		},
	};
}
