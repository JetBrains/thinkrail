import type { NativeUpdateBridge, NativeUpdateState } from "@thinkrail/contracts";
import { useEffect, useState } from "react";

const NATIVE_UPDATES_GLOBAL = "__THINKRAIL_NATIVE_UPDATES__";

export function getNativeUpdateBridge(value: unknown): NativeUpdateBridge | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return typeof Reflect.get(value, "getState") === "function" &&
		typeof Reflect.get(value, "checkForUpdates") === "function" &&
		typeof Reflect.get(value, "restartToUpdate") === "function" &&
		typeof Reflect.get(value, "subscribe") === "function"
		? (value as NativeUpdateBridge)
		: null;
}

function updateErrorText(error: unknown): string {
	if (error instanceof Error && error.message.trim()) return error.message;
	if (typeof error === "string" && error.trim()) return error;
	return "The native update request failed";
}

export function runNativeUpdateRequest(
	operation: () => Promise<void>,
	onError: (error: string) => void,
): void {
	try {
		void operation().catch((error) => onError(updateErrorText(error)));
	} catch (error) {
		onError(updateErrorText(error));
	}
}

export function subscribeToNativeUpdates(
	bridge: NativeUpdateBridge,
	onState: (state: NativeUpdateState) => void,
	onError: (error: string) => void,
): () => void {
	let active = true;
	let revision = -1;
	const accept = (state: NativeUpdateState): void => {
		if (!active || state.revision < revision) return;
		revision = state.revision;
		onState(state);
	};
	const reject = (error: unknown): void => {
		if (active) onError(updateErrorText(error));
	};
	let unsubscribe: (() => void) | undefined;
	try {
		unsubscribe = bridge.subscribe(accept);
	} catch (error) {
		reject(error);
	}
	try {
		void bridge.getState().then(accept, reject);
	} catch (error) {
		reject(error);
	}
	return () => {
		active = false;
		unsubscribe?.();
	};
}

export function useNativeUpdates() {
	const [bridge] = useState(() =>
		getNativeUpdateBridge(Reflect.get(globalThis, NATIVE_UPDATES_GLOBAL)),
	);
	const [state, setState] = useState<NativeUpdateState | null>(null);
	const [requestError, setRequestError] = useState<string | null>(null);

	useEffect(() => {
		if (!bridge) return;
		return subscribeToNativeUpdates(
			bridge,
			(next) => {
				setState(next);
				setRequestError(null);
			},
			setRequestError,
		);
	}, [bridge]);

	if (!bridge) return null;
	const request = (operation: () => Promise<void>): void => {
		setRequestError(null);
		runNativeUpdateRequest(operation, setRequestError);
	};
	return {
		state,
		requestError,
		checkForUpdates: () => request(() => bridge.checkForUpdates()),
		restartToUpdate: () => request(() => bridge.restartToUpdate()),
	};
}
