import { expect, test } from "bun:test";
import {
	createNativeUpdateController,
	isStrictlyNewerVersion,
	type NativeUpdaterDependency,
	type NativeUpdaterInfo,
	type NativeUpdaterStatusEntry,
} from "./controller";
import { hasDesktopArtifactTestSeam, nativeUpdatesEnabled } from "./enablement";

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
	let resolve = (_value: T): void => {};
	let reject = (_error: unknown): void => {};
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

async function settle(): Promise<void> {
	for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

class FakeUpdater implements NativeUpdaterDependency {
	info: NativeUpdaterInfo = {
		version: "1.1.0",
		updateAvailable: true,
		updateReady: false,
		error: "",
	};
	checkCalls = 0;
	downloadCalls = 0;
	checkResult: Promise<NativeUpdaterInfo> | undefined;
	downloadResult: Promise<void> | undefined;
	listener: ((entry: NativeUpdaterStatusEntry) => void) | null = null;

	updateInfo(): NativeUpdaterInfo {
		return this.info;
	}

	onStatusChange(listener: ((entry: NativeUpdaterStatusEntry) => void) | null): void {
		this.listener = listener;
	}

	async checkForUpdate(): Promise<NativeUpdaterInfo> {
		this.checkCalls += 1;
		return this.checkResult ? this.checkResult : this.info;
	}

	async downloadUpdate(): Promise<void> {
		this.downloadCalls += 1;
		if (this.downloadResult) await this.downloadResult;
	}

	emit(entry: NativeUpdaterStatusEntry): void {
		this.listener?.(entry);
	}
}

function scheduledController(updater: FakeUpdater, restartToUpdate = async () => {}) {
	const scheduled: Array<{ delay: number; callback: () => void; cancelled: boolean }> = [];
	const controller = createNativeUpdateController({
		enabled: true,
		version: "1.0.0",
		channel: "stable",
		updater,
		restartToUpdate,
		random: () => 0.5,
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

async function findAvailable(
	controller: ReturnType<typeof scheduledController>["controller"],
): Promise<void> {
	await controller.checkForUpdates();
	await settle();
	expect((await controller.getState()).status).toBe("available");
}

async function prepareUpdate(
	controller: ReturnType<typeof scheduledController>["controller"],
	updater: FakeUpdater,
): Promise<void> {
	await findAvailable(controller);
	const pendingDownload = deferred<void>();
	updater.downloadResult = pendingDownload.promise;
	await controller.downloadUpdate();
	updater.info = { ...updater.info, updateReady: true };
	updater.emit({ status: "download-complete", message: "prepared" });
	pendingDownload.resolve(undefined);
	await settle();
	expect((await controller.getState()).status).toBe("ready");
}

test("enables only supported packaged production identities and blocks artifact seams", () => {
	const enabled = {
		isPackaged: true,
		channel: "stable",
		baseUrl: "https://updates.example.test/releases",
		platform: "darwin" as const,
		arch: "arm64",
		artifactTestSeam: false,
	};
	expect(nativeUpdatesEnabled(enabled)).toBe(true);
	expect(nativeUpdatesEnabled({ ...enabled, channel: "canary" })).toBe(true);
	expect(nativeUpdatesEnabled({ ...enabled, isPackaged: false })).toBe(false);
	expect(nativeUpdatesEnabled({ ...enabled, channel: "dev" })).toBe(false);
	expect(nativeUpdatesEnabled({ ...enabled, baseUrl: "" })).toBe(false);
	expect(nativeUpdatesEnabled({ ...enabled, baseUrl: "not a URL" })).toBe(false);
	expect(nativeUpdatesEnabled({ ...enabled, baseUrl: "http://updates.example.test" })).toBe(false);
	expect(nativeUpdatesEnabled({ ...enabled, artifactTestSeam: true })).toBe(false);
	expect(nativeUpdatesEnabled({ ...enabled, platform: "darwin", arch: "x64" })).toBe(false);
	expect(hasDesktopArtifactTestSeam({ THINKRAIL_DESKTOP_READY_FILE: "/tmp/ready" })).toBe(true);
	expect(hasDesktopArtifactTestSeam({})).toBe(false);
});

test("automatic and prompt checks coalesce, stop at available, and schedule the next check", async () => {
	const updater = new FakeUpdater();
	const pendingCheck = deferred<NativeUpdaterInfo>();
	updater.checkResult = pendingCheck.promise;
	const { controller, scheduled } = scheduledController(updater);
	const revisions: number[] = [];
	controller.subscribe((state) => revisions.push(state.revision));

	controller.start();
	expect(scheduled.map((entry) => entry.delay)).toEqual([0]);
	scheduled[0]?.callback();
	expect((await controller.getState()).status).toBe("checking");
	await controller.checkForUpdates();
	await controller.checkForUpdates();
	expect(updater.checkCalls).toBe(1);

	pendingCheck.resolve(updater.info);
	await settle();
	expect(updater.downloadCalls).toBe(0);
	expect(await controller.getState()).toMatchObject({
		status: "available",
		availableVersion: "1.1.0",
		progress: null,
		error: null,
		failedPhase: null,
	});
	expect(revisions.length).toBeGreaterThan(1);
	expect(revisions).toEqual([...revisions].sort((left, right) => left - right));
	expect(scheduled.at(-1)?.delay).toBe(6 * 60 * 60 * 1000);
});

test("download is explicit and coalesced, publishes transfer then preparation, and requires matching readiness", async () => {
	const updater = new FakeUpdater();
	const { controller } = scheduledController(updater);
	await findAvailable(controller);
	const pendingDownload = deferred<void>();
	updater.downloadResult = pendingDownload.promise;

	await controller.downloadUpdate();
	await controller.downloadUpdate();
	expect(updater.downloadCalls).toBe(1);
	expect((await controller.getState()).status).toBe("downloading");

	updater.emit({
		status: "download-progress",
		message: "transferring",
		details: { progress: 42 },
	});
	expect(await controller.getState()).toMatchObject({ status: "downloading", progress: 42 });
	updater.emit({ status: "applying-patch", message: "applying first patch" });
	expect((await controller.getState()).status).toBe("preparing");
	updater.emit({ status: "downloading-full-bundle", message: "falling back" });
	expect(await controller.getState()).toMatchObject({ status: "downloading", progress: null });
	updater.emit({
		status: "download-progress",
		message: "transferring fallback",
		details: { progress: 17 },
	});
	expect(await controller.getState()).toMatchObject({ status: "downloading", progress: 17 });
	updater.emit({
		status: "download-progress",
		message: "transferred",
		details: { progress: 100 },
	});
	expect(await controller.getState()).toMatchObject({ status: "preparing", progress: 100 });
	updater.emit({ status: "decompressing", message: "decompressing" });
	expect((await controller.getState()).status).toBe("preparing");

	updater.info = { ...updater.info, version: "1.2.0", updateReady: true };
	updater.emit({ status: "download-complete", message: "wrong package" });
	expect((await controller.getState()).status).toBe("preparing");
	updater.info = { ...updater.info, version: "1.1.0", updateReady: true };
	updater.emit({ status: "download-complete", message: "prepared" });
	expect((await controller.getState()).status).toBe("ready");

	updater.emit({
		status: "download-progress",
		message: "late progress",
		details: { progress: 60 },
	});
	updater.emit({
		status: "error",
		message: "late error",
		details: { errorMessage: "late error" },
	});
	expect((await controller.getState()).status).toBe("ready");
	pendingDownload.resolve(undefined);
	await settle();
	expect(await controller.getState()).toMatchObject({
		status: "ready",
		availableVersion: "1.1.0",
		progress: 100,
		error: null,
		failedPhase: null,
	});
});

test("install clicked from updateReady waits for the coalesced download acknowledgement", async () => {
	const updater = new FakeUpdater();
	const pendingDownload = deferred<void>();
	updater.downloadResult = pendingDownload.promise;
	let restartCalls = 0;
	const { controller } = scheduledController(updater, async () => {
		restartCalls += 1;
	});
	await findAvailable(controller);
	await controller.downloadUpdate();
	updater.info = { ...updater.info, updateReady: true };
	updater.emit({ status: "download-complete", message: "prepared" });
	expect((await controller.getState()).status).toBe("ready");

	await controller.restartToUpdate();
	expect((await controller.getState()).status).toBe("installing");
	expect(restartCalls).toBe(0);
	updater.emit({
		status: "download-progress",
		message: "late progress",
		details: { progress: 75 },
	});
	expect((await controller.getState()).status).toBe("installing");

	pendingDownload.resolve(undefined);
	await settle();
	expect(restartCalls).toBe(1);
	expect((await controller.getState()).status).toBe("installing");
});

test("check and download failures retain their retry phase", async () => {
	const updater = new FakeUpdater();
	const { controller } = scheduledController(updater);
	updater.info = { ...updater.info, error: "offline" };
	await controller.checkForUpdates();
	await settle();
	expect(await controller.getState()).toMatchObject({
		status: "error",
		error: "offline",
		failedPhase: "check",
	});

	updater.info = { ...updater.info, error: "" };
	await controller.checkForUpdates();
	await settle();
	expect((await controller.getState()).status).toBe("available");

	updater.info = { ...updater.info, error: "download failed" };
	await controller.downloadUpdate();
	updater.emit({ status: "error", message: "download failed" });
	updater.emit({ status: "decompressing", message: "late preparation" });
	await settle();
	expect(await controller.getState()).toMatchObject({
		status: "error",
		error: "download failed",
		failedPhase: "download",
		availableVersion: "1.1.0",
	});

	updater.info = { ...updater.info, error: "", updateReady: true };
	await controller.downloadUpdate();
	await settle();
	expect(updater.downloadCalls).toBe(2);
	expect((await controller.getState()).status).toBe("ready");
});

test("a prepared package survives an unrelated failed check and installs without a feed recheck", async () => {
	const updater = new FakeUpdater();
	const restart = deferred<void>();
	let restartCalls = 0;
	const { controller } = scheduledController(updater, () => {
		restartCalls += 1;
		return restart.promise;
	});
	await prepareUpdate(controller, updater);
	const checkCallsAfterPreparation = updater.checkCalls;

	updater.info = {
		version: "",
		updateAvailable: false,
		updateReady: false,
		error: "temporary feed failure",
	};
	await controller.checkForUpdates();
	await settle();
	expect(await controller.getState()).toMatchObject({
		status: "ready",
		availableVersion: "1.1.0",
		error: "temporary feed failure",
		failedPhase: "check",
	});

	await controller.restartToUpdate();
	await controller.restartToUpdate();
	await settle();
	expect(updater.checkCalls).toBe(checkCallsAfterPreparation + 1);
	expect(restartCalls).toBe(1);
	expect((await controller.getState()).status).toBe("installing");
	restart.resolve(undefined);
	await settle();
});

test("a failed installation retains the local package and retry dispatches installation again", async () => {
	const updater = new FakeUpdater();
	let restartCalls = 0;
	const { controller } = scheduledController(updater, async () => {
		restartCalls += 1;
		if (restartCalls === 1) throw new Error("restart was refused");
	});
	await prepareUpdate(controller, updater);
	const checked = updater.checkCalls;

	await controller.restartToUpdate();
	await settle();
	expect(await controller.getState()).toMatchObject({
		status: "error",
		error: "restart was refused",
		failedPhase: "install",
		availableVersion: "1.1.0",
	});
	await controller.restartToUpdate();
	await settle();
	expect(restartCalls).toBe(2);
	expect(updater.checkCalls).toBe(checked);
	expect((await controller.getState()).status).toBe("installing");
});

test("same and older versions are rejected and only checks receive bounded automatic retries", async () => {
	expect(isStrictlyNewerVersion("0.1.0-nightly.45", "0.1.0-nightly.46")).toBe(true);
	expect(isStrictlyNewerVersion("1.0.0", "1.0.0")).toBe(false);
	expect(isStrictlyNewerVersion("1.0.0", "0.9.0")).toBe(false);
	expect(isStrictlyNewerVersion("invalid", "2.0.0")).toBe(false);

	const updater = new FakeUpdater();
	updater.info = {
		version: "1.0.0",
		updateAvailable: true,
		updateReady: true,
		error: "",
	};
	const { controller, scheduled } = scheduledController(updater);
	await controller.checkForUpdates();
	await settle();
	expect((await controller.getState()).status).toBe("idle");
	expect(updater.downloadCalls).toBe(0);

	updater.info = { ...updater.info, error: "offline" };
	controller.start();
	for (const expectedDelay of [0, 60_000, 5 * 60_000, 30 * 60_000]) {
		const next = scheduled.at(-1);
		expect(next?.delay).toBe(expectedDelay);
		next?.callback();
		await settle();
	}
	expect(scheduled.at(-1)?.delay).toBe(6 * 60 * 60 * 1000);
	expect(updater.downloadCalls).toBe(0);
});
