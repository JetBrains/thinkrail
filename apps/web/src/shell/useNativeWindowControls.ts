import type { NativeWindowControlsBridge, NativeWindowState } from "@thinkrail/contracts";
import { useEffect, useState } from "react";

const NATIVE_WINDOW_CONTROLS_GLOBAL = "__THINKRAIL_NATIVE_WINDOW_CONTROLS__";

export function getNativeWindowControlsBridge(value: unknown): NativeWindowControlsBridge | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return typeof Reflect.get(value, "getState") === "function" &&
		typeof Reflect.get(value, "minimize") === "function" &&
		typeof Reflect.get(value, "toggleMaximize") === "function" &&
		typeof Reflect.get(value, "close") === "function" &&
		typeof Reflect.get(value, "subscribe") === "function"
		? (value as NativeWindowControlsBridge)
		: null;
}

export type NativeWindowControlsController = {
	state: NativeWindowState;
	minimize(): void;
	toggleMaximize(): void;
	close(): void;
};

function reportNativeWindowControlsFailure(action: string, error: unknown): void {
	console.warn(`Could not ${action} the native window`, error);
}

function runNativeWindowControlsRequest(action: string, operation: () => Promise<void>): void {
	try {
		void operation().catch((error) => reportNativeWindowControlsFailure(action, error));
	} catch (error) {
		reportNativeWindowControlsFailure(action, error);
	}
}

export function useNativeWindowControls(): NativeWindowControlsController | null {
	const [bridge] = useState(() =>
		getNativeWindowControlsBridge(Reflect.get(globalThis, NATIVE_WINDOW_CONTROLS_GLOBAL)),
	);
	const [state, setState] = useState<NativeWindowState | null>(null);

	useEffect(() => {
		if (!bridge) return;
		let active = true;
		const unsubscribe = bridge.subscribe((next) => {
			if (active) setState(next);
		});
		void bridge.getState().then((next) => {
			if (active) setState(next);
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}, [bridge]);

	if (!bridge || !state) return null;
	return {
		state,
		minimize: () => runNativeWindowControlsRequest("minimize", () => bridge.minimize()),
		toggleMaximize: () => runNativeWindowControlsRequest("resize", () => bridge.toggleMaximize()),
		close: () => runNativeWindowControlsRequest("close", () => bridge.close()),
	};
}
