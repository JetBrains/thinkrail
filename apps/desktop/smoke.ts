#!/usr/bin/env bun

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
	type ArtifactHostAdapter,
	type RunningArtifactHost,
	runArtifactHostProbes,
} from "@thinkrail/server/artifact-probes";
import { removeTree } from "@thinkrail/shared/removeTree";
import { locateDesktopLauncher } from "./src/artifact";

const desktopDir = import.meta.dir;
const repoRoot = resolve(desktopDir, "..", "..");
const root = mkdtempSync(join(tmpdir(), "thinkrail-desktop-smoke-"));
let sequence = 0;

async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${what}`)), ms);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function startWindowManager(): Promise<ReturnType<typeof Bun.spawn> | undefined> {
	const command = process.env.THINKRAIL_DESKTOP_SMOKE_WINDOW_MANAGER;
	if (process.platform !== "linux" || !command) return undefined;
	const windowManager = Bun.spawn([command, "--sm-disable"], {
		stdout: "inherit",
		stderr: "inherit",
	});
	try {
		await within(
			(async () => {
				while (!Bun.spawnSync(["wmctrl", "-m"], { stdout: "ignore", stderr: "ignore" }).success) {
					if (windowManager.exitCode !== null) {
						throw new Error(`${command} exited before becoming the active window manager`);
					}
					await Bun.sleep(50);
				}
			})(),
			10_000,
			`${command} window manager readiness`,
		);
		return windowManager;
	} catch (error) {
		windowManager.kill("SIGKILL");
		throw error;
	}
}

type LinuxWindowGeometry = { x: number; y: number; width: number; height: number };

function runNativeCommand(command: string[]): string {
	const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
	if (!result.success) {
		throw new Error(
			`${command.join(" ")} exited ${result.exitCode}: ${result.stderr.toString().trim()}`,
		);
	}
	return result.stdout.toString().trim();
}

function linuxWindowGeometry(windowId: string): LinuxWindowGeometry {
	const fields = Object.fromEntries(
		runNativeCommand(["xdotool", "getwindowgeometry", "--shell", windowId])
			.split("\n")
			.map((line) => line.split("=", 2)),
	);
	const geometry = {
		x: Number(fields.X),
		y: Number(fields.Y),
		width: Number(fields.WIDTH),
		height: Number(fields.HEIGHT),
	};
	if (Object.values(geometry).some((value) => !Number.isFinite(value))) {
		throw new Error("xdotool returned invalid window geometry");
	}
	return geometry;
}

async function waitForLinuxGeometry(
	windowId: string,
	accept: (geometry: LinuxWindowGeometry) => boolean,
	label: string,
): Promise<LinuxWindowGeometry> {
	const deadline = performance.now() + 5_000;
	while (true) {
		const geometry = linuxWindowGeometry(windowId);
		if (accept(geometry)) return geometry;
		if (performance.now() >= deadline) throw new Error(`Linux window did not ${label}`);
		await Bun.sleep(25);
	}
}

async function dragLinuxPointer(
	windowId: string,
	start: { x: number; y: number },
	delta: { x: number; y: number },
): Promise<void> {
	runNativeCommand([
		"xdotool",
		"mousemove",
		"--sync",
		"--window",
		windowId,
		String(start.x),
		String(start.y),
	]);
	runNativeCommand(["xdotool", "mousedown", "1"]);
	try {
		await Bun.sleep(150);
		runNativeCommand([
			"xdotool",
			"mousemove_relative",
			"--sync",
			"--",
			String(delta.x),
			String(delta.y),
		]);
	} finally {
		runNativeCommand(["xdotool", "mouseup", "1"]);
	}
}

async function resetLinuxWindow(windowId: string): Promise<LinuxWindowGeometry> {
	runNativeCommand(["xdotool", "windowsize", "--sync", windowId, "800", "600"]);
	runNativeCommand(["xdotool", "windowmove", "--sync", windowId, "200", "150"]);
	return waitForLinuxGeometry(
		windowId,
		(geometry) =>
			Math.abs(geometry.x - 200) <= 3 &&
			Math.abs(geometry.y - 150) <= 3 &&
			Math.abs(geometry.width - 800) <= 3 &&
			Math.abs(geometry.height - 600) <= 3,
		"reset to its smoke-test frame",
	);
}

async function runWindowsWindowInteractions(pid: number): Promise<void> {
	const probe = Bun.spawn(
		[
			"powershell.exe",
			"-NoProfile",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			join(desktopDir, "windows-window-interactions.ps1"),
			"-ProcessId",
			String(pid),
		],
		{ stdout: "inherit", stderr: "inherit" },
	);
	const code = await within(probe.exited, 120_000, "Windows native window interactions");
	if (code !== 0) throw new Error(`Windows native window interactions exited ${code}`);
}

async function runLinuxWindowInteractions(pid: number): Promise<void> {
	let windowId = "";
	const deadline = performance.now() + 5_000;
	while (!windowId) {
		const result = Bun.spawnSync(
			["xdotool", "search", "--onlyvisible", "--pid", String(pid), "--name", "ThinkRail"],
			{ stdout: "pipe", stderr: "ignore" },
		);
		windowId = result.success ? (result.stdout.toString().trim().split("\n")[0] ?? "") : "";
		if (windowId) break;
		if (performance.now() >= deadline) throw new Error("could not find the Linux desktop window");
		await Bun.sleep(25);
	}

	const moveBefore = await resetLinuxWindow(windowId);
	await dragLinuxPointer(windowId, { x: 300, y: 24 }, { x: 80, y: 60 });
	await waitForLinuxGeometry(
		windowId,
		(geometry) => geometry.x - moveBefore.x >= 40 && geometry.y - moveBefore.y >= 30,
		"move through the application titlebar",
	);

	const edges: Array<{
		name: string;
		start: { x: number; y: number };
		delta: { x: number; y: number };
		west?: true;
		east?: true;
		north?: true;
		south?: true;
	}> = [
		{
			name: "north-west",
			start: { x: 10, y: 10 },
			delta: { x: -30, y: -20 },
			west: true,
			north: true,
		},
		{ name: "north", start: { x: 400, y: 10 }, delta: { x: 0, y: -20 }, north: true },
		{
			name: "north-east",
			start: { x: 790, y: 10 },
			delta: { x: 30, y: -20 },
			east: true,
			north: true,
		},
		{ name: "west", start: { x: 10, y: 300 }, delta: { x: -30, y: 0 }, west: true },
		{ name: "east", start: { x: 790, y: 300 }, delta: { x: 30, y: 0 }, east: true },
		{
			name: "south-west",
			start: { x: 10, y: 590 },
			delta: { x: -30, y: 20 },
			west: true,
			south: true,
		},
		{ name: "south", start: { x: 400, y: 590 }, delta: { x: 0, y: 20 }, south: true },
		{
			name: "south-east",
			start: { x: 790, y: 590 },
			delta: { x: 30, y: 20 },
			east: true,
			south: true,
		},
	];
	for (const edge of edges) {
		const before = await resetLinuxWindow(windowId);
		await dragLinuxPointer(windowId, edge.start, edge.delta);
		await waitForLinuxGeometry(
			windowId,
			(geometry) =>
				(!edge.west || (geometry.x < before.x - 10 && geometry.width > before.width + 10)) &&
				(!edge.east || geometry.width > before.width + 10) &&
				(!edge.north || (geometry.y < before.y - 10 && geometry.height > before.height + 10)) &&
				(!edge.south || geometry.height > before.height + 10),
			`resize from the ${edge.name} compositor edge`,
		);
	}
}

function copyApplication(launcher: string): string {
	const bundleRoot =
		process.platform === "darwin"
			? dirname(dirname(dirname(launcher)))
			: dirname(dirname(launcher));
	const resourcesDir = join(
		bundleRoot,
		process.platform === "darwin" ? "Contents" : "",
		"Resources",
	);
	if (!existsSync(join(resourcesDir, "app", "runtime", "server-runtime.ts"))) {
		throw new Error("desktop smoke requires an expanded app bundle, not a first-install wrapper");
	}
	const copiedRoot = join(root, basename(bundleRoot));
	cpSync(bundleRoot, copiedRoot, { recursive: true });
	return join(copiedRoot, relative(bundleRoot, launcher));
}

const launcher = copyApplication(locateDesktopLauncher(desktopDir, process.argv[2]));

function isolatedEnvironment(root: string): Record<string, string> {
	return {
		...Object.fromEntries(
			Object.entries(process.env).filter(
				(entry): entry is [string, string] => entry[1] !== undefined,
			),
		),
		HOME: join(root, "home"),
		THINKRAIL_DATA_DIR: join(root, "data"),
		PI_CODING_AGENT_DIR: join(root, "agent"),
		XDG_CACHE_HOME: join(root, "cache"),
		THINKRAIL_NO_ANALYTICS: "1",
		PI_OFFLINE: "1",
	};
}

async function launchDesktop(
	env: Record<string, string>,
	label: string,
	mode: "host" | "ui" | "chrome" | "interactions",
): Promise<
	RunningArtifactHost & {
		pid: number;
		windowUrl: string;
		mode: string;
		applicationMenuInstalled: boolean;
		windowChromePlatform: string;
		titleBarStyle: string;
		windowChromePreloadReady: boolean;
		windowChromeProbe?: {
			nativeControls?: true;
			maximized?: true;
			restored?: true;
			minimized?: true;
			unminimized?: true;
		};
		requestWindowClose(): Promise<void>;
	}
> {
	const id = sequence++;
	const readyPath = join(root, `${id}-${label}.ready.json`);
	const controlPath = join(root, `${id}-${label}.control`);
	const userDataPath = join(root, `${id}-${label}-user-data`);
	const restoredRoute = mode === "host" ? undefined : "#/v1/projects/desktop-smoke";
	if (restoredRoute) {
		mkdirSync(userDataPath, { recursive: true });
		writeFileSync(
			join(userDataPath, "routes.json"),
			JSON.stringify({ version: 1, routes: { "local:main": restoredRoute } }),
		);
	}
	const appEnv = {
		...env,
		THINKRAIL_DESKTOP_READY_FILE: readyPath,
		THINKRAIL_DESKTOP_CONTROL_FILE: controlPath,
		THINKRAIL_DESKTOP_USER_DATA: userDataPath,
		THINKRAIL_DESKTOP_HIDDEN: mode === "chrome" || mode === "interactions" ? "0" : "1",
		...(mode === "host" ? { THINKRAIL_DESKTOP_E2E_HOST: "1" } : {}),
		...(mode === "chrome" ? { THINKRAIL_DESKTOP_WINDOW_CHROME_PROBE: "1" } : {}),
	};
	const command =
		process.platform === "darwin"
			? [
					"/usr/bin/sandbox-exec",
					"-p",
					`(version 1)(allow default)(deny file-read* (subpath ${JSON.stringify(repoRoot)}))`,
					launcher,
				]
			: [launcher];
	const proc = Bun.spawn(command, {
		env: appEnv,
		cwd: root,
		stdout: "inherit",
		stderr: "inherit",
	});
	try {
		await within(
			Promise.race([
				(async () => {
					while (!existsSync(readyPath)) await Bun.sleep(50);
				})(),
				proc.exited.then((code) => {
					throw new Error(`${label} desktop host exited early with ${code}`);
				}),
			]),
			30_000,
			`${label} desktop ready`,
		);
		const ready = JSON.parse(readFileSync(readyPath, "utf8")) as {
			origin: string;
			pid: number;
			runtimeDir: string;
			windowUrl: string;
			mode: string;
			applicationMenuInstalled: boolean;
			windowChromePlatform: string;
			titleBarStyle: string;
			windowChromePreloadReady: boolean;
			windowChromeProbe?: {
				nativeControls?: true;
				maximized?: true;
				restored?: true;
				minimized?: true;
				unminimized?: true;
			};
		};
		let stopped = false;
		const shutdown = async (command: "stop" | "close") => {
			if (stopped) return;
			stopped = true;
			if (proc.exitCode === null) writeFileSync(controlPath, command);
			const code = await within(proc.exited, 15_000, `${label} desktop shutdown`);
			if (code !== 0) throw new Error(`${label} desktop shutdown exited ${code}`);
		};
		return {
			origin: ready.origin,
			pid: ready.pid,
			windowUrl: ready.windowUrl,
			mode: ready.mode,
			applicationMenuInstalled: ready.applicationMenuInstalled,
			windowChromePlatform: ready.windowChromePlatform,
			titleBarStyle: ready.titleBarStyle,
			windowChromePreloadReady: ready.windowChromePreloadReady,
			...(ready.windowChromeProbe ? { windowChromeProbe: ready.windowChromeProbe } : {}),
			resources: {
				skillsDir: join(ready.runtimeDir, "skills"),
				trashHelpers: {
					macos: join(ready.runtimeDir, "macos-trash"),
					windows: join(ready.runtimeDir, "windows-trash.exe"),
				},
			},
			stop: () => shutdown("stop"),
			requestWindowClose: () => shutdown("close"),
		};
	} catch (error) {
		proc.kill("SIGKILL");
		throw error;
	}
}

const adapter: ArtifactHostAdapter = {
	name: "electrobun-desktop",
	launch: (env, label) => launchDesktop(env, label, "host"),
};

let windowManager: Awaited<ReturnType<typeof startWindowManager>>;
try {
	windowManager = await startWindowManager();
	const isolated = join(root, "ui");
	mkdirSync(isolated, { recursive: true });
	let ui: Awaited<ReturnType<typeof launchDesktop>> | undefined;
	try {
		ui = await launchDesktop(isolatedEnvironment(join(isolated, "native-ui")), "native-ui", "ui");
		const health = await within(fetch(`${ui.origin}/health`), 10_000, "desktop UI health");
		if (!health.ok || (await health.text()) !== "ok") throw new Error("desktop UI health failed");
		if (ui.mode !== "ui" || ui.windowUrl !== `${ui.origin}/#/v1/projects/desktop-smoke`) {
			throw new Error(`desktop native window reported an unexpected URL: ${ui.windowUrl}`);
		}
		const applicationMenuExpected = process.platform === "darwin" || process.platform === "win32";
		if (ui.applicationMenuInstalled !== applicationMenuExpected) {
			throw new Error("desktop native application menu registration did not match this platform");
		}
		const expectedChrome =
			process.platform === "darwin"
				? { platform: "macos", titleBarStyle: "hiddenInset" }
				: process.platform === "win32"
					? { platform: "windows", titleBarStyle: "hiddenInset" }
					: { platform: "linux", titleBarStyle: "hidden" };
		if (
			ui.windowChromePlatform !== expectedChrome.platform ||
			ui.titleBarStyle !== expectedChrome.titleBarStyle ||
			!ui.windowChromePreloadReady
		) {
			throw new Error("desktop native window chrome did not initialize its platform policy");
		}
	} finally {
		if (ui) await ui.stop();
	}
	let chrome: Awaited<ReturnType<typeof launchDesktop>> | undefined;
	try {
		chrome = await launchDesktop(
			isolatedEnvironment(join(isolated, "chrome")),
			"native-window-chrome",
			"chrome",
		);
		if (process.platform === "darwin") {
			if (chrome.windowChromeProbe?.nativeControls !== true) {
				throw new Error("desktop native macOS window controls were not retained");
			}
		} else if (
			chrome.windowChromeProbe?.maximized !== true ||
			chrome.windowChromeProbe.restored !== true ||
			chrome.windowChromeProbe.minimized !== true ||
			chrome.windowChromeProbe.unminimized !== true
		) {
			throw new Error("desktop native window transitions did not complete");
		}
		await chrome.requestWindowClose();
	} finally {
		if (chrome) await chrome.stop();
	}
	if (process.env.THINKRAIL_DESKTOP_NATIVE_INTERACTION === "1") {
		let interactions: Awaited<ReturnType<typeof launchDesktop>> | undefined;
		try {
			interactions = await launchDesktop(
				isolatedEnvironment(join(isolated, "interactions")),
				"native-window-interactions",
				"interactions",
			);
			if (process.platform === "win32") await runWindowsWindowInteractions(interactions.pid);
			if (process.platform === "linux") await runLinuxWindowInteractions(interactions.pid);
			await interactions.requestWindowClose();
		} finally {
			if (interactions) await interactions.stop();
		}
	}
	await runArtifactHostProbes(adapter);
	console.log(`smoke OK: ${launcher} passed native-window and shared artifact probes.`);
} catch (error) {
	console.error(`desktop smoke FAILED: ${error instanceof Error ? error.message : error}`);
	process.exitCode = 1;
} finally {
	windowManager?.kill("SIGKILL");
	removeTree(root);
}
