import { expect, test } from "bun:test";
import {
	createDesktopQuitCoordinator,
	type DesktopBeforeQuitEvent,
	type DesktopQuitCoordinator,
} from "./quitCoordinator";

interface Deferred {
	promise: Promise<void>;
	resolve(): void;
}

function deferred(): Deferred {
	let resolve = (): void => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function settle(): Promise<void> {
	for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function beforeQuitEvent(): DesktopBeforeQuitEvent {
	return { response: undefined };
}

test("ordinary quit shuts the host down once and never applies an update", async () => {
	const shutdown = deferred();
	let shutdownCalls = 0;
	let quitCalls = 0;
	let applyCalls = 0;
	const coordinator = createDesktopQuitCoordinator({
		shutdown: () => {
			shutdownCalls += 1;
			return shutdown.promise;
		},
		quit: () => {
			quitCalls += 1;
		},
		applyUpdate: async () => {
			applyCalls += 1;
		},
		getUpdateError: () => "",
		reportUpdateFailure: async () => {},
		reportLifecycleError: () => {},
	});
	const first = beforeQuitEvent();
	const repeated = beforeQuitEvent();
	coordinator.handleBeforeQuit(first);
	coordinator.handleBeforeQuit(repeated);
	expect(first.response).toEqual({ allow: false });
	expect(repeated.response).toEqual({ allow: false });
	await settle();
	expect(shutdownCalls).toBe(1);

	shutdown.resolve();
	await settle();
	expect(quitCalls).toBe(1);
	expect(applyCalls).toBe(0);
	const completed = beforeQuitEvent();
	coordinator.handleBeforeQuit(completed);
	expect(completed.response).toBeUndefined();
});

test("an update attempt that never requests quit cannot arm a later ordinary quit", async () => {
	let applyCalls = 0;
	let quitCalls = 0;
	const coordinator = createDesktopQuitCoordinator({
		shutdown: async () => {},
		quit: () => {
			quitCalls += 1;
		},
		applyUpdate: async () => {
			applyCalls += 1;
		},
		getUpdateError: () => "prepared update disappeared",
		reportUpdateFailure: async () => {},
		reportLifecycleError: () => {},
	});
	await coordinator.restartToUpdate();
	await settle();
	coordinator.handleBeforeQuit(beforeQuitEvent());
	await settle();
	expect(applyCalls).toBe(1);
	expect(quitCalls).toBe(1);
});

test("update intent waits for the vetoed apply to settle before resuming under the guard", async () => {
	const shutdown = deferred();
	const firstApply = deferred();
	let applyCalls = 0;
	let quitCalls = 0;
	let coordinator: DesktopQuitCoordinator;
	coordinator = createDesktopQuitCoordinator({
		shutdown: () => shutdown.promise,
		quit: () => {
			quitCalls += 1;
		},
		applyUpdate: async () => {
			applyCalls += 1;
			const event = beforeQuitEvent();
			coordinator.handleBeforeQuit(event);
			if (applyCalls === 1) {
				expect(event.response).toEqual({ allow: false });
				await firstApply.promise;
			} else {
				expect(event.response).toBeUndefined();
			}
		},
		getUpdateError: () => "",
		reportUpdateFailure: async () => {},
		reportLifecycleError: () => {},
	});

	void coordinator.restartToUpdate();
	void coordinator.restartToUpdate();
	await settle();
	expect(applyCalls).toBe(1);
	shutdown.resolve();
	await settle();
	expect(applyCalls).toBe(1);

	firstApply.resolve();
	await settle();
	expect(applyCalls).toBe(2);
	expect(quitCalls).toBe(0);
});

test("failed helper arming reports the error and exits the stopped host", async () => {
	const shutdown = deferred();
	let applyCalls = 0;
	let updateError = "";
	let quitCalls = 0;
	const failures: string[] = [];
	let coordinator: DesktopQuitCoordinator;
	coordinator = createDesktopQuitCoordinator({
		shutdown: () => shutdown.promise,
		quit: () => {
			quitCalls += 1;
		},
		applyUpdate: async () => {
			applyCalls += 1;
			if (applyCalls === 1) {
				coordinator.handleBeforeQuit(beforeQuitEvent());
			} else {
				updateError = "failed to arm update helper";
			}
		},
		getUpdateError: () => updateError,
		reportUpdateFailure: async (message) => {
			failures.push(message);
		},
		reportLifecycleError: () => {},
	});

	await coordinator.restartToUpdate();
	shutdown.resolve();
	await settle();
	expect(applyCalls).toBe(2);
	expect(failures).toEqual(["failed to arm update helper"]);
	expect(quitCalls).toBe(1);
});
