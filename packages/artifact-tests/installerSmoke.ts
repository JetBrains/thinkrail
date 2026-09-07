#!/usr/bin/env bun

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { removeTree } from "@thinkrail/shared/removeTree";
import { locateWindowsSetupExecutable } from "./src/artifact";
import { hostEnvironment } from "./src/artifactProbes";
import { assertInstallerSmokeEnvironment } from "./src/installerEnvironment";

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
	THINKRAIL_DESKTOP_READY_FILE: readyPath,
	THINKRAIL_DESKTOP_CONTROL_FILE: controlPath,
	THINKRAIL_DESKTOP_USER_DATA: join(root, "user-data"),
	THINKRAIL_DESKTOP_E2E_HOST: "1",
	THINKRAIL_DESKTOP_HIDDEN: "1",
});
let installerProcess: ReturnType<typeof Bun.spawn> | undefined;
let appPid: number | undefined;
let launcherPid: number | undefined;

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${what}`)), ms),
		),
	]);
}

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

async function waitForReady(exited: Promise<number>): Promise<void> {
	await within(
		Promise.race([
			(async () => {
				while (!existsSync(readyPath)) await Bun.sleep(50);
			})(),
			exited.then((code) => {
				if (code !== 0) throw new Error(`desktop installer launcher exited ${code}`);
				return new Promise<never>(() => {});
			}),
		]),
		60_000,
		"installed desktop ready",
	);
}

try {
	installerProcess = Bun.spawn([installerExecutable()], {
		cwd: root,
		env: isolationEnv,
		stdout: "inherit",
		stderr: "inherit",
	});
	await waitForReady(installerProcess.exited);
	const ready = JSON.parse(readFileSync(readyPath, "utf8")) as {
		origin?: unknown;
		pid?: unknown;
		launcherPid?: unknown;
		mode?: unknown;
	};
	if (
		typeof ready.origin !== "string" ||
		typeof ready.pid !== "number" ||
		!Number.isSafeInteger(ready.pid) ||
		ready.pid <= 0 ||
		typeof ready.launcherPid !== "number" ||
		!Number.isSafeInteger(ready.launcherPid) ||
		ready.launcherPid <= 0 ||
		ready.mode !== "host"
	) {
		throw new Error("installed desktop wrote an invalid ready document");
	}
	const pid = ready.pid;
	const nativePid = ready.launcherPid;
	appPid = pid;
	launcherPid = nativePid;
	const launcher =
		process.platform === "darwin"
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
	if (!existsSync(launcher)) throw new Error(`installed desktop launcher not found at ${launcher}`);
	const health = await within(fetch(`${ready.origin}/health`), 10_000, "installed desktop health");
	if (!health.ok || (await health.text()) !== "ok")
		throw new Error("installed desktop health failed");
	writeFileSync(controlPath, "stop");
	await within(
		(async () => {
			while (processAlive(pid) || processAlive(nativePid)) await Bun.sleep(50);
		})(),
		20_000,
		"installed desktop shutdown",
	);
	const installerExit = await within(installerProcess.exited, 20_000, "installer exit");
	if (installerExit !== 0) throw new Error(`desktop installer exited ${installerExit}`);
	console.log(`installer smoke OK: ${artifact}`);
} catch (error) {
	installerProcess?.kill("SIGKILL");
	if (appPid && processAlive(appPid)) process.kill(appPid, "SIGKILL");
	if (launcherPid && processAlive(launcherPid)) process.kill(launcherPid, "SIGKILL");
	throw error;
} finally {
	removeTree(root);
}
