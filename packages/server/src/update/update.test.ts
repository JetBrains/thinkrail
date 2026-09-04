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
	restart?: boolean;
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
	if (options.restart) provider.restart = async () => process.exit(0);
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
		restart: "manual",
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
	expect(persistedRecord().staged).toEqual({ version: "1.4.0", channel: "stable" });
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

test("a staged release survives a boot that did not pick it up", async () => {
	startUpdates({ provider: stubProvider() });
	await installUpdate({ channel: "stable", version: "1.4.0" });

	const status = startUpdates({ provider: stubProvider({ current: "1.3.0" }) });
	expect(status.phase).toBe("staged");
});

test("a provider offering restart reports the self capability", () => {
	const status = startUpdates({ provider: stubProvider({ restart: true }) });
	expect(status.capabilities.restart).toBe("self");
});

test("the checks preference gates the schedule and the manual check alike", async () => {
	const provider = stubProvider();
	startUpdates({ provider, checksEnabled: false, bootDelayMs: 1 });
	await checkForUpdate();
	expect(provider.checks).toBe(0);

	setUpdateChecksEnabled(true);
	await checkForUpdate();
	expect(provider.checks).toBe(1);
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
