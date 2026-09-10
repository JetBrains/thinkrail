import { describe, expect, test } from "bun:test";
import type { NativeUpdateBridge, NativeUpdateState } from "@thinkrail/contracts";
import {
	getNativeUpdateBridge,
	runNativeUpdateRequest,
	subscribeToNativeUpdates,
} from "./useNativeUpdates";

function state(revision: number, status: NativeUpdateState["status"]): NativeUpdateState {
	return {
		revision,
		status,
		version: "0.1.0",
		channel: "canary",
		availableVersion: status === "ready" ? "0.1.1" : null,
		progress: null,
		error: null,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
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
		push?.(state(2, "ready"));
		initial.resolve(state(1, "idle"));
		await initial.promise;
		await Promise.resolve();
		expect(observed).toEqual([state(2, "ready")]);
		unsubscribe();
	});

	test("request errors are captured without a browser action manager", async () => {
		const errors: string[] = [];
		runNativeUpdateRequest(
			async () => {
				throw new Error("Update RPC timed out");
			},
			(error) => errors.push(error),
		);
		await Promise.resolve();
		expect(errors).toEqual(["Update RPC timed out"]);
	});

	test("an ordinary browser or incomplete global has no native capability", () => {
		expect(getNativeUpdateBridge(undefined)).toBeNull();
		expect(getNativeUpdateBridge({ getState() {} })).toBeNull();
	});
});
