import { describe, expect, test } from "bun:test";
import type { HostUpdateNotice, NativeUpdateBridge, NativeUpdateState } from "@thinkrail/contracts";
import {
	getNativeUpdateBridge,
	hasNativeUpdateSurface,
	runNativeUpdateRequest,
	selectUpdateSource,
	subscribeToNativeUpdates,
} from "./useUpdates";

function nativeState(revision: number, status: NativeUpdateState["status"]): NativeUpdateState {
	return {
		revision,
		status,
		version: "0.1.0",
		channel: "canary",
		availableVersion:
			status === "available" ||
			status === "downloading" ||
			status === "preparing" ||
			status === "ready"
				? "0.1.1"
				: null,
		progress: null,
		error: null,
		failedPhase: null,
	};
}

function hostNotice(): HostUpdateNotice {
	return {
		currentVersion: "0.1.0",
		channel: "stable",
		availableVersion: "0.2.0",
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function nativeBridge(state = nativeState(1, "idle")): NativeUpdateBridge {
	return {
		getState: async () => state,
		checkForUpdates: async () => {},
		downloadUpdate: async () => {},
		restartToUpdate: async () => {},
		subscribe: () => () => {},
	};
}

describe("native update shell subscription", () => {
	test("subscribes before reading and keeps a newer push over the initial read", async () => {
		const initial = deferred<NativeUpdateState>();
		const order: string[] = [];
		const observed: NativeUpdateState[] = [];
		let push: ((next: NativeUpdateState) => void) | undefined;
		const bridge: NativeUpdateBridge = {
			getState: () => {
				order.push("get");
				return initial.promise;
			},
			checkForUpdates: async () => {},
			downloadUpdate: async () => {},
			restartToUpdate: async () => {},
			subscribe: (listener) => {
				order.push("subscribe");
				push = listener;
				return () => {};
			},
		};

		const unsubscribe = subscribeToNativeUpdates(
			bridge,
			(next) => observed.push(next),
			() => {},
		);
		expect(order).toEqual(["subscribe", "get"]);
		push?.(nativeState(2, "ready"));
		initial.resolve(nativeState(1, "idle"));
		await initial.promise;
		await Promise.resolve();
		expect(observed).toEqual([nativeState(2, "ready")]);
		unsubscribe();
	});

	test("request errors carry the failed native action", async () => {
		const errors: Array<{ action: string; message: string }> = [];
		runNativeUpdateRequest(
			"download",
			async () => {
				throw new Error("Update RPC timed out");
			},
			(error) => errors.push(error),
		);
		await Promise.resolve();
		expect(errors).toEqual([{ action: "download", message: "Update RPC timed out" }]);
	});

	test("bridge validation requires the complete download-capable surface", () => {
		expect(getNativeUpdateBridge(undefined)).toBeNull();
		expect(getNativeUpdateBridge({ getState() {} })).toBeNull();
		expect(
			getNativeUpdateBridge({
				getState: async () => nativeState(1, "idle"),
				checkForUpdates: async () => {},
				restartToUpdate: async () => {},
				subscribe: () => () => {},
			}),
		).toBeNull();
		expect(getNativeUpdateBridge(nativeBridge())).not.toBeNull();
	});
});

describe("unified update capability", () => {
	test("native authority wins while resolving and when disabled instead of falling through to host", () => {
		const bridge = nativeBridge();
		expect(selectUpdateSource(bridge, hostNotice())).toBe("native");
		expect(hasNativeUpdateSurface(null)).toBe(false);
		expect(hasNativeUpdateSurface(nativeState(1, "disabled"))).toBe(false);
		expect(hasNativeUpdateSurface(nativeState(2, "idle"))).toBe(true);
	});

	test("host authority exists exactly when no native bridge and an immutable notice is present", () => {
		expect(selectUpdateSource(null, hostNotice())).toBe("host");
		expect(selectUpdateSource(null, null)).toBeNull();
	});
});
