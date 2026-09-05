import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AvailableRelease, UpdateInstallTarget, UpdateStatus } from "@thinkrail/contracts";
import {
	checkForUpdate,
	dismissUpdate,
	getUpdateStatus,
	type InstallOutcome,
	installUpdate,
	resetUpdateState,
	setUpdateChecksEnabled,
	setUpdatePublisher,
	startUpdates,
	stopUpdates,
	type UpdateProvider,
} from "./index";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-update-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetUpdateState();
});

afterEach(() => {
	resetUpdateState();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

const RELEASE: AvailableRelease = {
	version: "1.4.0",
	channel: "stable",
	notesUrl: "https://example.invalid/v1.4.0",
};

interface StubOptions {
	install?: boolean;
	current?: string;
	found?: AvailableRelease | null;
	checkError?: Error;
	outcome?: InstallOutcome;
	installationId?: string;
}

interface Stub extends UpdateProvider {
	checks: number;
	installs: UpdateInstallTarget[];
}

function stubProvider(options: StubOptions = {}): Stub {
	const provider: Stub = {
		checks: 0,
		installs: [],
		capabilities: {
			install: options.install ?? true,
			channelSwitch: "in-app",
			channels: ["stable", "nightly"],
		},
		installationId: options.installationId ?? "cli:/home/u/.local/bin/thinkrail",
		current: { version: options.current ?? "1.3.0", channel: "stable" },
		async check() {
			provider.checks += 1;
			if (options.checkError) throw options.checkError;
			return options.found === undefined ? RELEASE : options.found;
		},
		async install(target) {
			provider.installs.push(target);
			return (
				options.outcome ?? {
					kind: "staged",
					version: target.version ?? "1.4.0",
					channel: target.channel,
				}
			);
		},
	};
	return provider;
}

function persistedRecord(): Record<string, unknown> {
	return JSON.parse(readFileSync(join(dataDir, "update.json"), "utf8")) as Record<string, unknown>;
}

test("no provider means no capability and no phase churn", () => {
	const status = startUpdates({ appVersion: "0.0.0-dev" });
	expect(status.phase).toBe("idle");
	expect(status.capabilities).toEqual({
		install: false,
		channelSwitch: "unsupported",
		channels: [],
	});
	expect(status.current).toEqual({ version: "0.0.0-dev", channel: "dev" });
});

test("a host that cannot install never reaches the network", async () => {
	const provider = stubProvider({ install: false });
	startUpdates({ provider });
	const status = await checkForUpdate();
	expect(provider.checks).toBe(0);
	expect(status.phase).toBe("idle");
});

test("a found release becomes available and publishes both transitions", async () => {
	const seen: UpdateStatus[] = [];
	setUpdatePublisher((status) => seen.push(status));
	startUpdates({ provider: stubProvider() });
	await checkForUpdate();

	expect(seen.map((s) => s.phase)).toEqual(["idle", "checking", "available"]);
	expect(getUpdateStatus().available).toEqual(RELEASE);
	expect(typeof persistedRecord().lastCheckedAt).toBe("number");
});

test("concurrent checks share one in-flight run", async () => {
	const provider = stubProvider();
	startUpdates({ provider });
	await Promise.all([checkForUpdate(), checkForUpdate(), checkForUpdate()]);
	expect(provider.checks).toBe(1);
});

test("a failed check reports the error without erasing the running version", async () => {
	startUpdates({ provider: stubProvider({ checkError: new Error("offline") }) });
	const status = await checkForUpdate();
	expect(status.phase).toBe("error");
	expect(status.error).toEqual({ kind: "failed", message: "offline", retryable: true });
	expect(status.current.version).toBe("1.3.0");
});

test("a later clean check clears an earlier error", async () => {
	const provider = stubProvider({ checkError: new Error("offline") });
	startUpdates({ provider });
	await checkForUpdate();
	provider.check = async () => null;
	const status = await checkForUpdate();
	expect(status.phase).toBe("idle");
	expect(status.error).toBeUndefined();
});

test("installing stages the release, clears the dismissal, and persists it", async () => {
	const provider = stubProvider();
	startUpdates({ provider });
	await checkForUpdate();
	dismissUpdate("1.4.0");

	const status = await installUpdate({ channel: "stable", version: "1.4.0" });
	expect(status.phase).toBe("staged");
	expect(status.staged).toEqual({ version: "1.4.0", channel: "stable" });
	expect(status.available).toBeUndefined();
	expect(status.dismissedVersion).toBeUndefined();
	expect(provider.installs).toEqual([{ channel: "stable", version: "1.4.0" }]);
	expect(persistedRecord().staged).toEqual({
		version: "1.4.0",
		channel: "stable",
		from: "1.3.0",
		installationId: "cli:/home/u/.local/bin/thinkrail",
	});
});

test("a manual outcome is an instruction, not a fault", async () => {
	startUpdates({
		provider: stubProvider({
			outcome: { kind: "manual", message: "no PowerShell found", command: "irm … | iex" },
		}),
	});
	const status = await installUpdate({ channel: "stable" });
	expect(status.phase).toBe("error");
	expect(status.error).toEqual({
		kind: "manual",
		message: "no PowerShell found",
		retryable: false,
		command: "irm … | iex",
	});
	expect(status.staged).toBeUndefined();
});

test("a thrown install surfaces as a retryable failure", async () => {
	const provider = stubProvider();
	provider.install = async () => {
		throw new Error("prefix not writable");
	};
	startUpdates({ provider });
	const status = await installUpdate({ channel: "stable" });
	expect(status.error).toEqual({
		kind: "failed",
		message: "prefix not writable",
		retryable: true,
	});
});

test("a host that cannot install refuses an install outright", async () => {
	startUpdates({ provider: stubProvider({ install: false }) });
	await expect(installUpdate({ channel: "stable" })).rejects.toThrow("cannot install updates");
});

test("dismissal survives a restart of the module and silences only the banner", async () => {
	startUpdates({ provider: stubProvider() });
	await checkForUpdate();
	dismissUpdate("1.4.0");
	expect(persistedRecord().dismissedVersion).toBe("1.4.0");

	const status = startUpdates({ provider: stubProvider() });
	expect(status.dismissedVersion).toBe("1.4.0");
	expect(status.phase).toBe("idle");
});

test("a staged release whose version is now running is cleared at boot", async () => {
	startUpdates({ provider: stubProvider() });
	await installUpdate({ channel: "stable", version: "1.4.0" });

	const status = startUpdates({ provider: stubProvider({ current: "1.4.0" }) });
	expect(status.staged).toBeUndefined();
	expect(status.phase).toBe("idle");
	expect(persistedRecord().staged).toBeUndefined();
});

test("a staged release is void once the running version is neither the target nor the origin", async () => {
	startUpdates({ provider: stubProvider() });
	await installUpdate({ channel: "stable", version: "1.4.0" });

	// The user installed 1.5.0 some other way: the staged expectation cannot come true any more.
	const status = startUpdates({ provider: stubProvider({ current: "1.5.0" }) });
	expect(status.phase).toBe("idle");
	expect(persistedRecord().staged).toBeUndefined();
});

test("a staged release belongs to the installation that staged it, and is left alone by others", async () => {
	startUpdates({ provider: stubProvider({ installationId: "cli:/opt/a/bin/thinkrail" }) });
	await installUpdate({ channel: "stable", version: "1.4.0" });

	// A second installation sharing the data dir must neither advertise nor delete it.
	const other = startUpdates({
		provider: stubProvider({ installationId: "cli:/opt/b/bin/thinkrail" }),
	});
	expect(other.phase).toBe("idle");
	expect(other.staged).toBeUndefined();
	expect(persistedRecord().staged).toMatchObject({ installationId: "cli:/opt/a/bin/thinkrail" });

	// And a host that cannot install anything (a source run) reports nothing either.
	const source = startUpdates({ appVersion: "0.0.0-dev" });
	expect(source.phase).toBe("idle");
	expect(source.staged).toBeUndefined();
	expect(persistedRecord().staged).toMatchObject({ version: "1.4.0" });

	// Its own installation still sees it.
	const owner = startUpdates({
		provider: stubProvider({ installationId: "cli:/opt/a/bin/thinkrail" }),
	});
	expect(owner.phase).toBe("staged");
	expect(owner.staged).toEqual({ version: "1.4.0", channel: "stable" });
});

test("a staged release survives a boot that did not pick it up", async () => {
	startUpdates({ provider: stubProvider() });
	await installUpdate({ channel: "stable", version: "1.4.0" });

	const status = startUpdates({ provider: stubProvider({ current: "1.3.0" }) });
	expect(status.phase).toBe("staged");
});

test("the preference stops the host polling, but never a check the user asked for", async () => {
	const provider = stubProvider();
	startUpdates({ provider, checksEnabled: false, bootDelayMs: 5, intervalMs: 10 });

	// No schedule while polling is off...
	await Bun.sleep(40);
	expect(provider.checks).toBe(0);

	// ...but `update.check` is defined as "force one check", so an explicit request is honoured.
	const status = await checkForUpdate();
	expect(provider.checks).toBe(1);
	expect(status.available).toEqual(RELEASE);
	stopUpdates();
});

test("turning the preference back on starts the schedule", async () => {
	const provider = stubProvider();
	startUpdates({ provider, checksEnabled: false, bootDelayMs: 5, intervalMs: 10_000 });
	setUpdateChecksEnabled(true);
	await Bun.sleep(40);
	expect(provider.checks).toBe(1);
	stopUpdates();
});

test("the boot check runs on its own after the configured delay", async () => {
	const provider = stubProvider();
	startUpdates({ provider, bootDelayMs: 5, intervalMs: 60_000 });
	await Bun.sleep(40);
	expect(provider.checks).toBe(1);
	stopUpdates();
});

test("stopping cancels the schedule", async () => {
	const provider = stubProvider();
	startUpdates({ provider, bootDelayMs: 5, intervalMs: 10 });
	stopUpdates();
	await Bun.sleep(40);
	expect(provider.checks).toBe(0);
});

test("a check cannot clear the phase of an install that started meanwhile", async () => {
	let releaseCheck: (() => void) | undefined;
	const provider = stubProvider();
	provider.check = () =>
		new Promise((resolve) => {
			releaseCheck = () => resolve(RELEASE);
		});
	let releaseInstall: (() => void) | undefined;
	let installs = 0;
	provider.install = (target) => {
		installs += 1;
		return new Promise((resolve) => {
			releaseInstall = () =>
				resolve({ kind: "staged", version: target.version ?? "1.4.0", channel: target.channel });
		});
	};

	startUpdates({ provider });
	const checking = checkForUpdate();
	expect(getUpdateStatus().phase).toBe("checking");

	const installing = installUpdate({ channel: "stable" });
	expect(getUpdateStatus().phase).toBe("installing");

	releaseCheck?.();
	await checking;
	expect(getUpdateStatus().phase).toBe("installing");

	// A second install while the first is in flight must not start another installer.
	await installUpdate({ channel: "nightly" });
	expect(installs).toBe(1);

	releaseInstall?.();
	await installing;
	expect(getUpdateStatus().phase).toBe("staged");
});

test("a check started before a restart of the module cannot write into the new one", async () => {
	let releaseCheck: (() => void) | undefined;
	const old = stubProvider({ current: "1.0.0" });
	old.check = () =>
		new Promise((resolve) => {
			releaseCheck = () => resolve({ ...RELEASE, version: "1.1.0" });
		});

	startUpdates({ provider: old });
	const checking = checkForUpdate();

	startUpdates({ provider: stubProvider({ current: "9.0.0", found: null }) });
	releaseCheck?.();
	await checking;

	expect(getUpdateStatus().available).toBeUndefined();
	expect(getUpdateStatus().phase).toBe("idle");
	expect(getUpdateStatus().current.version).toBe("9.0.0");
});

test("an install that finishes during shutdown still persists what it staged", async () => {
	let releaseInstall: (() => void) | undefined;
	const provider = stubProvider();
	provider.install = () =>
		new Promise((resolve) => {
			releaseInstall = () => resolve({ kind: "staged", version: "1.4.0", channel: "stable" });
		});

	startUpdates({ provider });
	const installing = installUpdate({ channel: "stable", version: "1.4.0" });
	stopUpdates();
	releaseInstall?.();
	await installing;

	expect(persistedRecord().staged).toMatchObject({ version: "1.4.0", channel: "stable" });
});
