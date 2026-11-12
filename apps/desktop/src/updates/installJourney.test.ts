import { expect, test } from "bun:test";
import {
	createNativeUpdateController,
	type NativeUpdaterDependency,
	type NativeUpdaterInfo,
	type NativeUpdaterStatusEntry,
} from "./controller";
import type { UpdateJournal, UpdateJournalStore } from "./journal";
import { createDesktopQuitCoordinator, type DesktopQuitCoordinator } from "./quitCoordinator";

async function settle(): Promise<void> {
	for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function deferred(): { promise: Promise<void>; resolve(): void } {
	let resolve = (): void => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

class FakeUpdater implements NativeUpdaterDependency {
	info: NativeUpdaterInfo = {
		version: "1.1.0",
		updateAvailable: true,
		updateReady: true,
		error: "",
	};
	listener: ((entry: NativeUpdaterStatusEntry) => void) | null = null;

	updateInfo(): NativeUpdaterInfo {
		return this.info;
	}

	onStatusChange(listener: ((entry: NativeUpdaterStatusEntry) => void) | null): void {
		this.listener = listener;
	}

	async checkForUpdate(): Promise<NativeUpdaterInfo> {
		return this.info;
	}

	async downloadUpdate(): Promise<void> {}

	emit(entry: NativeUpdaterStatusEntry): void {
		this.listener?.(entry);
	}
}

class MemoryJournal implements UpdateJournalStore {
	value: UpdateJournal | null;

	constructor(value: UpdateJournal | null = null) {
		this.value = value;
	}

	read(): UpdateJournal | null {
		return this.value;
	}

	write(journal: UpdateJournal): void {
		this.value = journal;
	}

	clear(): void {
		this.value = null;
	}
}

function journalController(
	updater: FakeUpdater,
	journal: MemoryJournal,
	options: { version?: string; restartToUpdate?: () => Promise<boolean> } = {},
) {
	const scheduled: Array<{ delay: number; callback: () => void; cancelled: boolean }> = [];
	let clock = 1_000;
	const controller = createNativeUpdateController({
		enabled: true,
		version: options.version ?? "1.0.0",
		channel: "stable",
		updater,
		journal,
		restartToUpdate: options.restartToUpdate ?? (async () => true),
		random: () => 0.5,
		now: () => {
			clock += 500;
			return clock;
		},
		schedule: (delay, callback) => {
			const entry = { delay, callback, cancelled: false };
			scheduled.push(entry);
			return () => {
				entry.cancelled = true;
			};
		},
	});
	return { controller, scheduled };
}

async function readyController(
	updater: FakeUpdater,
	journal: MemoryJournal,
	options: { restartToUpdate?: () => Promise<boolean> } = {},
) {
	const created = journalController(updater, journal, options);
	await created.controller.checkForUpdates();
	await settle();
	expect((await created.controller.getState()).status).toBe("ready");
	return created;
}

const pendingJournal: UpdateJournal = {
	schemaVersion: 1,
	state: "pending",
	fromVersion: "1.0.0",
	toVersion: "1.1.0",
	startedAt: 10,
	log: [
		{
			at: 10,
			source: "update",
			level: "info",
			event: { kind: "installStarted", version: "1.1.0" },
		},
	],
};

test("an install attempt spans the vetoed first call and journals the handoff before quit", async () => {
	const updater = new FakeUpdater();
	const journal = new MemoryJournal();
	const { controller } = await readyController(updater, journal);

	await controller.restartToUpdate();
	await settle();
	expect(await controller.getState()).toMatchObject({
		status: "installing",
		installStep: "stopping",
		lastInstall: null,
	});
	updater.emit({
		status: "idle",
		message: "Update restart was cancelled by a before-quit handler",
	});
	expect((await controller.getState()).installStep).toBe("stopping");

	updater.emit({ status: "applying", message: "Preparing update handoff..." });
	expect((await controller.getState()).installStep).toBe("handoff");
	updater.emit({
		status: "launching-new-version",
		message: "Update prepared; restarting application...",
	});
	const state = await controller.getState();
	expect(state.installStep).toBe("restarting");
	expect(state.log.map((entry) => [entry.source, entry.event])).toEqual([
		["update", { kind: "installStarted", version: "1.1.0" }],
		["host", { kind: "hostStopping" }],
		["host", { kind: "hostStopped", seconds: 0.5 }],
		["update", { kind: "handoffStarted" }],
		["update", { kind: "restarting" }],
	]);
	expect(journal.value).toMatchObject({
		state: "pending",
		fromVersion: "1.0.0",
		toVersion: "1.1.0",
		log: state.log,
	});
});

test("a second-handoff error ends the attempt instead of leaving it installing", async () => {
	const updater = new FakeUpdater();
	const journal = new MemoryJournal();
	const { controller } = await readyController(updater, journal);
	await controller.restartToUpdate();
	await settle();

	updater.info = { ...updater.info, error: "Failed to start update helper: denied" };
	updater.emit({ status: "error", message: "Failed to start update helper: denied" });
	const state = await controller.getState();
	expect(state).toMatchObject({
		status: "error",
		failedPhase: "install",
		installStep: null,
		error: "Failed to start update helper: denied",
	});
	expect(state.log.at(-1)).toMatchObject({
		level: "error",
		event: { kind: "diagnostic", text: "Failed to start update helper: denied" },
	});
	expect(journal.value).toBeNull();
});

test("a handoff that never starts shutdown fails the attempt with the SDK error or a default", async () => {
	const updater = new FakeUpdater();
	const { controller } = await readyController(updater, new MemoryJournal(), {
		restartToUpdate: async () => false,
	});
	await controller.restartToUpdate();
	await settle();
	expect(await controller.getState()).toMatchObject({
		status: "error",
		failedPhase: "install",
		error: "ThinkRail couldn't start the installer",
	});
});

test("a reconciled failure after relaunch becomes a durable result merged with the pending journal", async () => {
	const updater = new FakeUpdater();
	const journal = new MemoryJournal(pendingJournal);
	const { controller, scheduled } = journalController(updater, journal);
	expect(scheduled.map((entry) => entry.delay)).toEqual([5000]);

	updater.emit({
		status: "error",
		message: "Update to 1.1.0 failed during swapping: AccessDenied",
		details: { errorMessage: "AccessDenied" },
	});
	const result = (await controller.getState()).lastInstall;
	if (!result) throw new Error("expected a reconciled result");
	expect(result).toMatchObject({
		outcome: "failed",
		fromVersion: "1.0.0",
		toVersion: "1.1.0",
		failedStep: "swapping",
		detail: "AccessDenied",
	});
	expect(result.log.map((entry) => entry.event)).toEqual([
		{ kind: "installStarted", version: "1.1.0" },
		{ kind: "installFailed", version: "1.1.0", step: "swapping", detail: "AccessDenied" },
	]);
	expect(journal.value).toEqual({ schemaVersion: 1, state: "resolved", result });
	expect(scheduled[0]?.cancelled).toBe(true);

	const rehydrated = journalController(new FakeUpdater(), journal).controller;
	expect((await rehydrated.getState()).lastInstall).toEqual(result);
	await rehydrated.dismissInstallResult();
	expect((await rehydrated.getState()).lastInstall).toBeNull();
	expect(journal.value).toBeNull();
});

test("a reconciled success without a journal reports an upgrade from an older build", async () => {
	const updater = new FakeUpdater();
	const journal = new MemoryJournal();
	const { controller, scheduled } = journalController(updater, journal, { version: "1.1.0" });
	expect(scheduled).toEqual([]);
	updater.emit({ status: "complete", message: "Update to 1.1.0 completed successfully" });
	expect((await controller.getState()).lastInstall).toMatchObject({
		outcome: "installed",
		fromVersion: null,
		toVersion: "1.1.0",
		failedStep: null,
		detail: null,
	});
	updater.emit({ status: "error", message: "Failed to check for updates" });
	expect((await controller.getState()).lastInstall?.outcome).toBe("installed");
});

test("a pending journal without an installer result resolves by the running version", async () => {
	for (const [version, outcome] of [
		["1.0.0", "unreported"],
		["1.1.0", "installed"],
	] as const) {
		const journal = new MemoryJournal(pendingJournal);
		const { controller, scheduled } = journalController(new FakeUpdater(), journal, { version });
		expect((await controller.getState()).lastInstall).toBeNull();
		scheduled[0]?.callback();
		expect((await controller.getState()).lastInstall).toMatchObject({
			outcome,
			fromVersion: "1.0.0",
			toVersion: "1.1.0",
			log: pendingJournal.log,
		});
		expect(journal.value?.state).toBe("resolved");
	}
});

test("accepting a new install attempt clears the previous result", async () => {
	const updater = new FakeUpdater();
	const journal = new MemoryJournal(pendingJournal);
	const { controller, scheduled } = await readyController(updater, journal);
	scheduled[0]?.callback();
	expect((await controller.getState()).lastInstall?.outcome).toBe("unreported");
	await controller.restartToUpdate();
	expect((await controller.getState()).lastInstall).toBeNull();
	expect(journal.value).toBeNull();
});

test("the controller and quit coordinator keep one attempt through a delayed shutdown", async () => {
	const updater = new FakeUpdater();
	const journal = new MemoryJournal();
	const shutdown = deferred();
	let applyCalls = 0;
	let coordinator: DesktopQuitCoordinator;
	coordinator = createDesktopQuitCoordinator({
		shutdown: () => shutdown.promise,
		quit: () => {},
		applyUpdate: async () => {
			applyCalls += 1;
			if (applyCalls === 1) {
				coordinator.handleBeforeQuit({ response: undefined });
				updater.emit({ status: "idle", message: "Update restart was cancelled" });
				return;
			}
			updater.emit({ status: "applying", message: "Preparing update handoff" });
			updater.emit({ status: "launching-new-version", message: "Update prepared" });
		},
		getUpdateError: () => "",
		reportUpdateFailure: async () => {},
		reportLifecycleError: () => {},
	});
	const { controller } = await readyController(updater, journal, {
		restartToUpdate: () => coordinator.restartToUpdate(),
	});
	await controller.restartToUpdate();
	await settle();
	expect(await controller.getState()).toMatchObject({
		status: "installing",
		installStep: "stopping",
	});

	shutdown.resolve();
	await settle();
	expect(applyCalls).toBe(2);
	expect(await controller.getState()).toMatchObject({
		status: "installing",
		installStep: "restarting",
	});
	expect(journal.value?.state).toBe("pending");
});

test("the quit coordinator reports whether the update handoff continues past the first call", async () => {
	const dependencies = {
		shutdown: async () => {},
		quit: () => {},
		getUpdateError: () => "",
		reportUpdateFailure: async () => {},
		reportLifecycleError: () => {},
	};
	const idle = createDesktopQuitCoordinator({ ...dependencies, applyUpdate: async () => {} });
	expect(await idle.restartToUpdate()).toBe(false);

	let vetoing: DesktopQuitCoordinator;
	vetoing = createDesktopQuitCoordinator({
		...dependencies,
		applyUpdate: async () => vetoing.handleBeforeQuit({ response: undefined }),
	});
	expect(await vetoing.restartToUpdate()).toBe(true);
});
