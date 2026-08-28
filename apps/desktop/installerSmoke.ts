#!/usr/bin/env bun

import {
	cpSync,
	existsSync,
	globSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { locateWindowsSetupExecutable } from "./src/artifact";

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
const isolationEnv = {
	...process.env,
	HOME: join(root, "home"),
	USERPROFILE: join(root, "home"),
	LOCALAPPDATA: join(root, "local"),
	APPDATA: join(root, "roaming"),
	XDG_DATA_HOME: join(root, "xdg-data"),
	XDG_CACHE_HOME: join(root, "cache"),
};
let appProcess: ReturnType<typeof Bun.spawn> | undefined;
let appPid: number | undefined;

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

function installedLauncher(): string {
	if (process.platform === "darwin") {
		const mount = join(root, "mount");
		mkdirSync(mount, { recursive: true });
		run(["hdiutil", "attach", artifact, "-nobrowse", "-readonly", "-mountpoint", mount]);
		try {
			const app = globSync(join(mount, "*.app"))[0];
			if (!app) throw new Error("desktop DMG does not contain an app bundle");
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
		run([locateWindowsSetupExecutable(packageDir, channel)]);
		return join(root, "local", "ai.thinkrail.app", channel, "app", "bin", "launcher.exe");
	}
	run(["tar", "-xzf", artifact, "-C", packageDir]);
	const installer = join(packageDir, "installer");
	if (!existsSync(installer)) throw new Error("desktop setup tarball does not contain installer");
	run([installer]);
	return join(root, "xdg-data", "ai.thinkrail.app", channel, "app", "bin", "launcher");
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
	const launcher = installedLauncher();
	if (!existsSync(launcher)) throw new Error(`installed desktop launcher not found at ${launcher}`);
	appProcess = Bun.spawn([launcher], {
		cwd: root,
		env: {
			...isolationEnv,
			THINKRAIL_DATA_DIR: join(root, "data"),
			PI_CODING_AGENT_DIR: join(root, "agent"),
			PI_OFFLINE: "1",
			THINKRAIL_NO_ANALYTICS: "1",
			THINKRAIL_DESKTOP_READY_FILE: readyPath,
			THINKRAIL_DESKTOP_CONTROL_FILE: controlPath,
			THINKRAIL_DESKTOP_USER_DATA: join(root, "user-data"),
			THINKRAIL_DESKTOP_E2E_HOST: "1",
			THINKRAIL_DESKTOP_HIDDEN: "1",
		},
		stdout: "inherit",
		stderr: "inherit",
	});
	await waitForReady(appProcess.exited);
	const ready = JSON.parse(readFileSync(readyPath, "utf8")) as {
		origin?: unknown;
		pid?: unknown;
		mode?: unknown;
	};
	if (typeof ready.origin !== "string" || typeof ready.pid !== "number" || ready.mode !== "host") {
		throw new Error("installed desktop wrote an invalid ready document");
	}
	const pid = ready.pid;
	appPid = pid;
	const health = await within(fetch(`${ready.origin}/health`), 10_000, "installed desktop health");
	if (!health.ok || (await health.text()) !== "ok")
		throw new Error("installed desktop health failed");
	writeFileSync(controlPath, "stop");
	await within(
		(async () => {
			while (processAlive(pid)) await Bun.sleep(50);
		})(),
		20_000,
		"installed desktop shutdown",
	);
	const launcherExit = await within(appProcess.exited, 20_000, "installer launcher exit");
	if (launcherExit !== 0) throw new Error(`installed desktop exited ${launcherExit}`);
	console.log(`installer smoke OK: ${artifact}`);
} catch (error) {
	appProcess?.kill("SIGKILL");
	if (appPid && processAlive(appPid)) process.kill(appPid, "SIGKILL");
	throw error;
} finally {
	rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
