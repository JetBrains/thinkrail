import { parsePairingUri } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import {
	connectRemoteProject,
	type RemoteConnectError,
	type RemoteConnection,
} from "@thinkrail/remote-client";
import { useAppStore } from "../store";
import { initTransport, mountRemoteSession } from "../transport";
import { connectFailureText, failureOf, type HostFailure } from "./connectFailure";

export type RemoteConnectionState =
	| { status: "idle" }
	| { status: "connecting"; link: string }
	| { status: "connected"; connection: RemoteConnection }
	| { status: "error"; kind: "invalid-link" }
	| { status: "error"; kind: "failed"; failure: HostFailure };

export interface RemoteConnectionController {
	getState(): RemoteConnectionState;
	subscribe(listener: () => void): () => void;
	/** A newer `connect` or a `reset` supersedes one in flight; its late connection is closed, never shown. */
	connect(link: string, label: string): Promise<void>;
	reset(): void;
}

type Connector = (
	link: string,
	options: { label: string; onLost: (error: RemoteConnectError) => void },
) => Promise<RemoteConnection>;

/**
 * Drives the "add a project by link" lifecycle: validate the pairing link, connect through the device
 * connector, and track idle → connecting → connected | error for the UI, which mounts the connected
 * connection (`mountRemoteHost`). A connection lost for good later reaches `onLost` with its host key. The
 * connector is injected (default `connectRemoteProject`) so the controller is unit-tested without a
 * browser/relay.
 */
export function createRemoteConnectionController(
	connector: Connector = connectRemoteProject,
	onLost: (hostKey: string, error: RemoteConnectError) => void = reportRemoteHostLost,
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
			const pairing = parsePairingUri(link);
			if (!pairing) {
				set({ status: "error", kind: "invalid-link" });
				return;
			}
			set({ status: "connecting", link });
			try {
				const connection = await connector(link, {
					label,
					onLost: (error) => onLost(pairing.hostPublicKey, error),
				});
				if (current !== attempt) {
					connection.close();
					return;
				}
				set({ status: "connected", connection });
			} catch (error) {
				if (current !== attempt) return;
				set({ status: "error", kind: "failed", failure: failureOf(error) });
			}
		},
		reset() {
			attempt += 1;
			set({ status: "idle" });
		},
	};
}

/** Mounts the app on a connected remote host; the transport owns the connection and closes it when replaced. */
export function mountRemoteHost(connection: RemoteConnection): void {
	mountRemoteSession(connection.client, connection.hostKey, { onClose: () => connection.close() });
}

/**
 * A mounted remote host lost for good (it revoked this device, its key changed): the store reads
 * `disconnected` and an error toast says why, with the way back to this computer's own host. A host the app
 * already left is ignored.
 */
export function reportRemoteHostLost(hostKey: string, error: unknown): void {
	const state = useAppStore.getState();
	if (state.remoteHostKey !== hostKey) return;
	state.setStatus("disconnected");
	state.pushToast({
		variant: "error",
		title: t("panels.connectByLink.lost.title"),
		message: connectFailureText(t, failureOf(error)),
		action: {
			label: t("panels.connectByLink.lost.backToLocal"),
			onClick: () => void initTransport(),
		},
	});
}
