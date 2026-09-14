import type { HostUpdateNotice, NativeUpdateBridge, NativeUpdateState } from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { useAppStore } from "../store";

const NATIVE_UPDATES_GLOBAL = "__THINKRAIL_NATIVE_UPDATES__";

export type UpdatesController =
	| {
			source: "native";
			state: NativeUpdateState | null;
			requestError: string | null;
			checkForUpdates(): void;
			restartToUpdate(): void;
	  }
	| {
			source: "host";
			state: HostUpdateNotice;
	  };

export function getNativeUpdateBridge(value: unknown): NativeUpdateBridge | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return typeof Reflect.get(value, "getState") === "function" &&
		typeof Reflect.get(value, "checkForUpdates") === "function" &&
		typeof Reflect.get(value, "restartToUpdate") === "function" &&
		typeof Reflect.get(value, "subscribe") === "function"
		? (value as NativeUpdateBridge)
		: null;
}

function nativeUpdateErrorText(error: unknown): string {
	if (error instanceof Error && error.message.trim()) return error.message;
	if (typeof error === "string" && error.trim()) return error;
	return "The native update request failed";
}

export function runNativeUpdateRequest(
	operation: () => Promise<void>,
	onError: (error: string) => void,
): void {
	try {
		void operation().catch((error) => onError(nativeUpdateErrorText(error)));
	} catch (error) {
		onError(nativeUpdateErrorText(error));
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
		if (active) onError(nativeUpdateErrorText(error));
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

export function selectUpdateSource(
	bridge: NativeUpdateBridge | null,
	hostUpdate: HostUpdateNotice | null,
): "native" | "host" | null {
	if (bridge) return "native";
	return hostUpdate === null ? null : "host";
}

export function useUpdates(): UpdatesController | null {
	const [bridge] = useState(() =>
		getNativeUpdateBridge(Reflect.get(globalThis, NATIVE_UPDATES_GLOBAL)),
	);
	const [nativeState, setNativeState] = useState<NativeUpdateState | null>(null);
	const [nativeRequestError, setNativeRequestError] = useState<string | null>(null);
	const hostUpdate = useAppStore((state) => state.hostUpdate);

	useEffect(() => {
		if (!bridge) return;
		return subscribeToNativeUpdates(
			bridge,
			(next) => {
				setNativeState(next);
				setNativeRequestError(null);
			},
			setNativeRequestError,
		);
	}, [bridge]);

	const source = selectUpdateSource(bridge, hostUpdate);
	if (source === "native" && bridge) {
		const request = (operation: () => Promise<void>): void => {
			setNativeRequestError(null);
			runNativeUpdateRequest(operation, setNativeRequestError);
		};
		return {
			source,
			state: nativeState,
			requestError: nativeRequestError,
			checkForUpdates: () => request(() => bridge.checkForUpdates()),
			restartToUpdate: () => request(() => bridge.restartToUpdate()),
		};
	}
	if (source === "host" && hostUpdate) return { source, state: hostUpdate };
	return null;
}
