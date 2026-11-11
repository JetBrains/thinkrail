import { parsePairingUri } from "@thinkrail/contracts";
import { connectRemoteProject, type RemoteConnection } from "@thinkrail/remote-client";

export type RemoteConnectionState =
	| { status: "idle" }
	| { status: "connecting"; link: string }
	| { status: "connected"; connection: RemoteConnection }
	| { status: "error"; kind: "invalid-link" }
	| { status: "error"; kind: "failed"; message: string };

export interface RemoteConnectionController {
	getState(): RemoteConnectionState;
	subscribe(listener: () => void): () => void;
	/** A newer `connect` or a `reset` supersedes one in flight; its late connection is closed, never shown. */
	connect(link: string, label: string): Promise<void>;
	reset(): void;
}

type Connector = (link: string, options: { label: string }) => Promise<RemoteConnection>;

/**
 * Drives the "add a project by link" lifecycle: validate the pairing link, connect through the device
 * connector, and track idle → connecting → connected | error for the UI, which mounts the connected client
 * (`mountRemoteSession`). The connector is injected (default `connectRemoteProject`) so the controller is
 * unit-tested without a browser/relay.
 */
export function createRemoteConnectionController(
	connector: Connector = connectRemoteProject,
): RemoteConnectionController {
	let state: RemoteConnectionState = { status: "idle" };
	let attempt = 0;
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
			const current = ++attempt;
			if (!parsePairingUri(link)) {
				set({ status: "error", kind: "invalid-link" });
				return;
			}
			set({ status: "connecting", link });
			try {
				const connection = await connector(link, { label });
				if (current !== attempt) {
					connection.close();
					return;
				}
				set({ status: "connected", connection });
			} catch (error) {
				if (current !== attempt) return;
				set({
					status: "error",
					kind: "failed",
					message: error instanceof Error ? error.message : String(error),
				});
			}
		},
		reset() {
			attempt += 1;
			set({ status: "idle" });
		},
	};
}
