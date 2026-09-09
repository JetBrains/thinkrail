import { describe, expect, test } from "bun:test";
import type { NativeUpdateBridge, NativeUpdateState } from "@thinkrail/contracts";
import { asNativeUpdateBridge, NativeUpdateController } from "./controller";

function updateState(
	revision: number,
	status: NativeUpdateState["status"],
	overrides: Partial<NativeUpdateState> = {},
): NativeUpdateState {
	return {
		revision,
		status,
		version: "0.1.0",
		channel: "canary",
		availableVersion: null,
		progress: null,
		error: null,
		...overrides,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe("native update controller", () => {
	test("subscribes before the initial read and ignores its stale revision", async () => {
		const initial = deferred<NativeUpdateState>();
		const order: string[] = [];
		let push: ((state: NativeUpdateState) => void) | undefined;
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
		const controller = new NativeUpdateController(bridge);
		const unsubscribe = controller.subscribe(() => {});

		expect(order).toEqual(["subscribe", "get"]);
		push?.(updateState(2, "ready", { availableVersion: "0.1.1" }));
		initial.resolve(updateState(1, "idle"));
		await initial.promise;
		await Promise.resolve();

		expect(controller.getSnapshot().state).toEqual(
			updateState(2, "ready", { availableVersion: "0.1.1" }),
		);
		unsubscribe();
		controller.dispose();
	});

	test("deduplicates pending actions and captures rejections", async () => {
		const check = deferred<void>();
		const restart = deferred<void>();
		let checkCalls = 0;
		let restartCalls = 0;
		let push: ((state: NativeUpdateState) => void) | undefined;
		const bridge: NativeUpdateBridge = {
			getState: async () => updateState(1, "idle"),
			checkForUpdates: () => {
				checkCalls += 1;
				return check.promise;
			},
			restartToUpdate: () => {
				restartCalls += 1;
				return restart.promise;
			},
			subscribe: (listener) => {
				push = listener;
				return () => {};
			},
		};
		const controller = new NativeUpdateController(bridge);
		controller.subscribe(() => {});
		await Promise.resolve();

		controller.checkForUpdates();
		controller.checkForUpdates();
		expect(checkCalls).toBe(1);
		expect(controller.getSnapshot().pendingAction).toBe("check");
		check.reject(new Error("Update feed unavailable"));
		await check.promise.catch(() => {});
		await Promise.resolve();
		expect(controller.getSnapshot()).toMatchObject({
			pendingAction: null,
			actionError: "Update feed unavailable",
		});

		push?.(updateState(2, "ready", { availableVersion: "0.1.1" }));
		controller.restartToUpdate();
		controller.restartToUpdate();
		expect(restartCalls).toBe(1);
		restart.resolve();
		await restart.promise;
		await Promise.resolve();
		expect(controller.getSnapshot().pendingAction).toBeNull();
		controller.dispose();
	});

	test("treats a missing or incomplete optional global as unavailable", () => {
		expect(asNativeUpdateBridge(undefined)).toBeNull();
		expect(asNativeUpdateBridge({ getState() {} })).toBeNull();
	});
});
