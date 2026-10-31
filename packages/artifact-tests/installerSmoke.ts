#!/usr/bin/env bun

import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { removeTree } from "@thinkrail/shared/removeTree";
import { locateWindowsSetupExecutable } from "./src/artifact";
import { hostEnvironment } from "./src/artifactProbes";
import { readSettledJson, waitForDocument } from "./src/documents";
import { assertInstallerSmokeEnvironment } from "./src/installerEnvironment";
import {
	pollUntil,
	reapProcess,
	runWithCleanup,
	windowsProcessesUnder,
	within,
} from "./src/lifecycle";

assertInstallerSmokeEnvironment(process.platform, process.env);

function resolveArtifact(value: string | undefined): string {
	if (!value) throw new Error("desktop installer path is required");
	const path = resolve(value);
	if (!existsSync(path)) throw new Error(`desktop installer not found at ${path}`);
	return path;
}

const artifact = resolveArtifact(process.argv[2]);
const root = mkdtempSync(join(tmpdir(), "thinkrail-desktop-installer-smoke-"));
const readyPath = join(root, "desktop.ready.json");
const controlPath = join(root, "desktop.control");
const channel = process.argv[3] ?? "stable";
if (channel !== "stable" && channel !== "canary") {
	throw new Error(`unsupported desktop installer channel: ${channel}`);
}
const isolationEnv = hostEnvironment({
	HOME: join(root, "home"),
	USERPROFILE: join(root, "home"),
	LOCALAPPDATA: join(root, "local"),
	APPDATA: join(root, "roaming"),
	XDG_DATA_HOME: join(root, "xdg-data"),
	XDG_CACHE_HOME: join(root, "cache"),
	ELECTROBUN_INSTALLER_UI_AUTOCLOSE: "1",
	THINKRAIL_DATA_DIR: join(root, "data"),
	PI_CODING_AGENT_DIR: join(root, "agent"),
	PI_OFFLINE: "1",
	THINKRAIL_NO_ANALYTICS: "1",
	CI: "1",
	THINKRAIL_DESKTOP_READY_FILE: readyPath,
	THINKRAIL_DESKTOP_CONTROL_FILE: controlPath,
	THINKRAIL_DESKTOP_USER_DATA: join(root, "user-data"),
	THINKRAIL_DESKTOP_E2E_HOST: "1",
	THINKRAIL_DESKTOP_HIDDEN: "1",
});
let installerProcess: ReturnType<typeof Bun.spawn> | undefined;
let appStopped = false;

function run(command: string[]): void {
	const result = Bun.spawnSync(command, {
		cwd: root,
		env: isolationEnv,
		stdout: "inherit",
		stderr: "inherit",
	});
	if (!result.success) throw new Error(`${command[0]} exited ${result.exitCode}`);
}

function installerExecutable(): string {
	if (process.platform === "darwin") {
		const mount = join(root, "mount");
		mkdirSync(mount, { recursive: true });
		run(["hdiutil", "attach", artifact, "-nobrowse", "-readonly", "-mountpoint", mount]);
		try {
			const appName = channel === "stable" ? "ThinkRail.app" : `ThinkRail-${channel}.app`;
			const app = join(mount, appName);
			if (!existsSync(app)) throw new Error(`desktop DMG does not contain ${appName}`);
			const installed = join(root, "ThinkRail.app");
			cpSync(app, installed, { recursive: true });
			return join(installed, "Contents", "MacOS", "launcher");
		} finally {
			run(["hdiutil", "detach", mount]);
		}
	}
	const packageDir = join(root, "package");
	mkdirSync(packageDir, { recursive: true });
	if (process.platform === "win32") {
		run([
			"powershell",
			"-NoProfile",
			"-Command",
			`Expand-Archive -LiteralPath '${artifact.replaceAll("'", "''")}' -DestinationPath '${packageDir.replaceAll("'", "''")}' -Force`,
		]);
		return locateWindowsSetupExecutable(packageDir, channel);
	}
	run(["tar", "-xzf", artifact, "-C", packageDir]);
	const installer = join(packageDir, "installer");
	if (!existsSync(installer)) throw new Error("desktop setup tarball does not contain installer");
	return installer;
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function validPid(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

interface InstalledReady {
	readonly origin: string;
	readonly pid: number;
	readonly launcherPid: number;
}

function acceptReady(document: unknown): InstalledReady | undefined {
	if (typeof document !== "object" || document === null) return undefined;
	const { origin, pid, launcherPid, mode } = document as Record<string, unknown>;
	if (typeof origin !== "string" || !validPid(pid) || !validPid(launcherPid) || mode !== "host") {
		return undefined;
	}
	return { origin, pid, launcherPid };
}

function readyDocumentPids(): number[] {
	const document = readSettledJson(readyPath);
	if (typeof document !== "object" || document === null) return [];
	const { pid, launcherPid } = document as Record<string, unknown>;
	return [pid, launcherPid].filter(validPid);
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function step<T>(name: string, run: () => T | Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		throw new Error(`installer smoke step "${name}" failed: ${message(error)}`, { cause: error });
	}
}

function installerExitError(code: number): Error | undefined {
	return code === 0 ? undefined : new Error(`desktop installer launcher exited ${code}`);
}

function installedLauncherPath(): string {
	return process.platform === "darwin"
		? join(root, "ThinkRail.app", "Contents", "MacOS", "launcher")
		: join(
				root,
				process.platform === "win32" ? "local" : "xdg-data",
				"ai.thinkrail.app",
				channel,
				"app",
				"bin",
				process.platform === "win32" ? "launcher.exe" : "launcher",
			);
}

async function smoke(): Promise<void> {
	const setup = await step("prepare installer", installerExecutable);
	const installer = await step("launch installer", () =>
		Bun.spawn([setup], {
			cwd: root,
			env: isolationEnv,
			stdout: "inherit",
			stderr: "inherit",
		}),
	);
	installerProcess = installer;
	const ready = await step("installed desktop ready", () =>
		waitForDocument(readyPath, acceptReady, {
			timeoutMs: 60_000,
			what: "installed desktop ready",
			exited: installer.exited,
			exitError: installerExitError,
		}),
	);
	await step("installed launcher location", () => {
		const launcher = installedLauncherPath();
		if (!existsSync(launcher)) throw new Error(`launcher not found at ${launcher}`);
	});
	await step("installed desktop health", async () => {
		const health = await within(
			fetch(`${ready.origin}/health`),
			10_000,
			`GET ${ready.origin}/health`,
		);
		const body = await within(health.text(), 10_000, "health body");
		if (!health.ok || body !== "ok") {
			throw new Error(
				`GET ${ready.origin}/health answered ${health.status} ${JSON.stringify(body)}`,
			);
		}
	});
	await step("installed desktop shutdown", async () => {
		writeFileSync(controlPath, "stop");
		await pollUntil(() => !processAlive(ready.pid) && !processAlive(ready.launcherPid), {
			timeoutMs: 20_000,
			what: `app ${ready.pid} and launcher ${ready.launcherPid} exit after stop`,
			exited: installer.exited,
			exitError: installerExitError,
		});
	});
	appStopped = true;
	await step("installer exit", async () => {
		const installerExit = await within(installer.exited, 20_000, "installer exit");
		if (installerExit !== 0) throw new Error(`desktop installer exited ${installerExit}`);
	});
	console.log(`installer smoke OK: ${artifact}`);
}

function installedProcessPids(): number[] {
	if (process.platform !== "win32") return [];
	const roots = [root];
	try {
		roots.push(realpathSync.native(root));
	} catch {}
	return windowsProcessesUnder(roots);
}

async function stopInstalledApp({ failed }: { failed: boolean }): Promise<void> {
	if (!failed || !installerProcess) return;
	const errors: unknown[] = [];
	const knownPids = appStopped ? [] : readyDocumentPids();
	try {
		knownPids.push(...installedProcessPids());
	} catch (error) {
		errors.push(error);
	}
	try {
		await reapProcess(installerProcess, { knownPids, timeoutMs: 15_000 });
	} catch (error) {
		errors.push(error);
	}
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) throw new AggregateError(errors, "installed desktop cleanup failed");
}

await runWithCleanup(smoke, [stopInstalledApp, () => removeTree(root)], {
	reportFailure: (error) => console.error("installer smoke failed:", error),
});
