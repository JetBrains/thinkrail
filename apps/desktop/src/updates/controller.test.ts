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
}

function deferred<T>(): Deferred<T> {
	let resolve = (_value: T): void => {};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function settle(): Promise<void> {
	for (let index = 0; index < 8; index += 1) await Promise.resolve();
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
		this.listener?.({ status: "download-progress", message: "half", details: { progress: 50 } });
		this.info = { ...this.info, updateReady: true };
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

test("checks after readiness, coalesces prompt requests, downloads, and publishes revisions", async () => {
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

	updater.checkResult = undefined;
	pendingCheck.resolve(updater.info);
	await settle();
	const ready = await controller.getState();
	expect(updater.downloadCalls).toBe(1);
	expect(ready).toMatchObject({
		status: "ready",
		availableVersion: "1.1.0",
		progress: 100,
		error: null,
	});
	expect(revisions.length).toBeGreaterThan(1);
	expect(revisions).toEqual([...revisions].sort((left, right) => left - right));
	expect(scheduled.at(-1)?.delay).toBe(6 * 60 * 60 * 1000);
});

test("keeps a prepared update when restart revalidation fails, then retries and restarts once", async () => {
	const updater = new FakeUpdater();
	const restart = deferred<void>();
	let restartCalls = 0;
	const { controller } = scheduledController(updater, () => {
		restartCalls += 1;
		return restart.promise;
	});

	await controller.checkForUpdates();
	await settle();
	expect((await controller.getState()).status).toBe("ready");

	updater.info = {
		version: "",
		updateAvailable: false,
		updateReady: false,
		error: "temporary feed failure",
	};
	await controller.restartToUpdate();
	await settle();
	expect(await controller.getState()).toMatchObject({
		status: "ready",
		availableVersion: "1.1.0",
		error: "temporary feed failure",
	});
	expect(restartCalls).toBe(0);

	updater.info = {
		version: "1.1.0",
		updateAvailable: true,
		updateReady: true,
		error: "",
	};
	await controller.checkForUpdates();
	await settle();
	expect((await controller.getState()).error).toBeNull();
	await controller.restartToUpdate();
	await controller.restartToUpdate();
	await settle();
	expect(updater.checkCalls).toBe(4);
	expect(restartCalls).toBe(1);
	expect((await controller.getState()).status).toBe("installing");
	restart.resolve();
	await settle();
});

test("rejects same and older versions and bounds automatic retries", async () => {
	expect(isStrictlyNewerVersion("0.1.0-nightly.45", "0.1.0-nightly.46")).toBe(true);
	expect(isStrictlyNewerVersion("1.0.0", "1.0.0")).toBe(false);
	expect(isStrictlyNewerVersion("1.0.0", "0.9.0")).toBe(false);
	expect(isStrictlyNewerVersion("invalid", "2.0.0")).toBe(false);

	const updater = new FakeUpdater();
	updater.info = {
		version: "1.0.0",
		updateAvailable: true,
		updateReady: false,
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
