#!/usr/bin/env bun

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, win32 } from "node:path";
import { removeTree } from "@thinkrail/shared/removeTree";
import { locateDesktopLauncher, repoRoot } from "./src/artifact";
import { hostEnvironment } from "./src/artifactProbes";

type Rect = Record<"left" | "top" | "right" | "bottom", number>;
type Geometry = { insetLeft: number; insetRight: number };
type Flags = Record<"fullScreen" | "maximized" | "minimized", boolean>;
export interface ChromeSample {
	sequence: number;
	ready: Record<"origin" | "runtimeDir" | "windowUrl" | "mode", string> &
		Record<"pid" | "launcherPid", number>;
	chrome: Flags &
		Record<"pid" | "hwnd" | "documentCount", number> & {
			frame: Record<"x" | "y" | "width" | "height", number>;
			geometry: Geometry | null;
		};
	native: Flags &
		Record<"hwnd" | "pid" | "dpi", number> &
		Record<"window" | "client" | "monitor", Rect> & { visible: boolean };
}
type State = "restored" | "maximized" | "fullscreen";

export function chromeArguments(args: string[], platform = process.platform, arch = process.arch) {
	if (platform !== "win32" || arch !== "x64")
		throw new Error("Chrome candidate smoke requires win32-x64");
	const options: { launcher?: string; evidenceDir?: string } = {};
	for (let i = 0; i < args.length; i += 2) {
		const flag = args[i];
		const value = args[i + 1];
		const key =
			flag === "--launcher" ? "launcher" : flag === "--evidence-dir" ? "evidenceDir" : undefined;
		if (!key || !value?.trim() || value.startsWith("--") || options[key]) {
			throw new Error(
				"Usage: chromeSmoke.ts [--launcher expanded/bin/launcher.exe] [--evidence-dir directory]",
			);
		}
		options[key] = resolve(value);
	}
	return options;
}

export function chromeEnvironment(root: string, inherited = process.env): Record<string, string> {
	const system = Object.fromEntries(
		Object.entries(inherited).filter(([key]) =>
			/^(systemroot|windir|comspec|systemdrive|pathext)$/i.test(key),
		),
	);
	const windows = Object.entries(system).find(([key]) => key.toLowerCase() === "systemroot")?.[1];
	if (!windows) throw new Error("SystemRoot is required");
	return hostEnvironment(
		{
			SystemRoot: windows,
			PSModulePath: join(windows, "System32", "WindowsPowerShell", "v1.0", "Modules"),
			HOME: join(root, "home"),
			USERPROFILE: join(root, "home"),
			LOCALAPPDATA: join(root, "local"),
			APPDATA: join(root, "roaming"),
			XDG_DATA_HOME: join(root, "xdg-data"),
			XDG_CONFIG_HOME: join(root, "config"),
			XDG_CACHE_HOME: join(root, "cache"),
			THINKRAIL_DATA_DIR: join(root, "data"),
			PI_CODING_AGENT_DIR: join(root, "agent"),
			THINKRAIL_DESKTOP_USER_DATA: join(root, "user-data"),
			WEBVIEW2_USER_DATA_FOLDER: join(root, "webview"),
			TEMP: join(root, "tmp"),
			TMP: join(root, "tmp"),
			HOMEDRIVE: win32.parse(root).root.replace(/[\\/]$/, ""),
			HOMEPATH: win32.join(root, "home").slice(2),
			PATH: [join(root, "app", "bin"), windows, join(windows, "System32")].join(";"),
			THINKRAIL_NO_ANALYTICS: "1",
			PI_OFFLINE: "1",
			ELECTROBUN_CONSOLE: "1",
			THINKRAIL_DESKTOP_HIDDEN: "0",
			THINKRAIL_DESKTOP_READY_FILE: join(root, "ready.json"),
			THINKRAIL_DESKTOP_CONTROL_FILE: join(root, "control"),
			THINKRAIL_DESKTOP_CHROME_PROBE_FILE: join(root, "chrome.json"),
		},
		[],
		system,
	);
}

function closeRect(a: Rect, b: Rect): boolean {
	return (["left", "top", "right", "bottom"] as const).every(
		(key) => Math.abs(a[key] - b[key]) <= 2,
	);
}

export function closeGeometry(a: Geometry, b: Geometry): boolean {
	return (["insetLeft", "insetRight"] as const).every((key) => Math.abs(a[key] - b[key]) <= 2);
}

export function measuredState(sample: ChromeSample, state: State, documentCount: number): boolean {
	const { chrome, native } = sample;
	const geometry = chrome.geometry;
	if (!geometry) return false;
	const finite = [geometry, chrome.frame, native.window, native.client, native.monitor].flatMap(
		Object.values,
	);
	if (!finite.every(Number.isFinite) || !Number.isFinite(native.dpi) || native.dpi <= 0)
		return false;
	if (![chrome.frame.x, chrome.frame.y].every(Number.isFinite)) return false;
	if (!(chrome.frame.width > 0 && chrome.frame.height > 0)) return false;
	if (chrome.pid !== native.pid || chrome.hwnd !== native.hwnd || sample.ready.pid !== native.pid)
		return false;
	if (!Number.isSafeInteger(chrome.documentCount) || chrome.documentCount < documentCount)
		return false;
	if (native.visible !== true || native.minimized !== false || chrome.minimized !== false)
		return false;
	if (chrome.fullScreen !== (state === "fullscreen") || native.fullScreen !== chrome.fullScreen)
		return false;
	if (
		native.maximized !== chrome.maximized ||
		(state !== "fullscreen" && chrome.maximized !== (state === "maximized"))
	)
		return false;
	if (
		![native.window, native.client, native.monitor].every(
			({ left, right, top, bottom }) => right > left && bottom > top,
		)
	)
		return false;
	const width = ((native.client.right - native.client.left) * 96) / native.dpi;
	if (
		width <= 0 ||
		geometry.insetLeft < 0 ||
		geometry.insetRight < 0 ||
		geometry.insetLeft + geometry.insetRight >= width
	)
		return false;
	return state === "fullscreen"
		? geometry.insetLeft === 0 &&
				geometry.insetRight === 0 &&
				closeRect(native.window, native.monitor)
		: geometry.insetLeft + geometry.insetRight > 0;
}

function readJson<T>(path: string): T | undefined {
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
		throw error;
	}
}

function inside(parent: string, child: string): boolean {
	const path = relative(parent, child);
	return path.split(/[\\/]/)[0] !== ".." && !isAbsolute(path);
}

async function waitForExit(proc: ReturnType<typeof Bun.spawn>, milliseconds: number) {
	const deadline = Date.now() + milliseconds;
	while (proc.exitCode === null && Date.now() < deadline) await Bun.sleep(100);
	return proc.exitCode !== null;
}

async function main(): Promise<void> {
	const options = chromeArguments(process.argv.slice(2));
	const source = locateDesktopLauncher(undefined, options.launcher);
	const bundle = dirname(dirname(source));
	if (!existsSync(join(bundle, "Resources", "app", "runtime", "server-runtime.ts")))
		throw new Error("An expanded application bundle is required");
	const scratch = tmpdir();
	if ([repoRoot, bundle].some((parent) => inside(parent, scratch)))
		throw new Error("OS temporary directory must be outside the repository and source bundle");
	if (options.evidenceDir) mkdirSync(options.evidenceDir, { recursive: true });
	const evidence = mkdtempSync(join(options.evidenceDir ?? scratch, "thinkrail-chrome-evidence-"));
	const root = mkdtempSync(join(scratch, "thinkrail-chrome-smoke-"));
	const request = join(root, "request");
	const states: { label: string; sample: ChromeSample }[] = [];
	const report: Record<string, unknown> = {
		label: "Windows packaged candidate state/geometry smoke",
		fullParity: false,
		source,
		evidence,
		isolation: root,
		missingQualification: [
			"real pointer/keyboard input, Snap, resizing and gestures",
			"DPI/display/theme changes",
			"accessibility (MSAA/UIA), including negative-height TITLEBARINFOEX title bounds",
			"visual/header clearance",
			"cross-platform",
		],
		states,
		success: false,
	};
	let inspector: ReturnType<typeof Bun.spawn> | undefined;
	let interrupted = false;
	const stop = () => {
		interrupted = true;
	};
	process.on("SIGINT", stop).on("SIGTERM", stop);
	console.log(`${report.label}; fullParity=false; evidence: ${evidence}`);
	try {
		const env = chromeEnvironment(root);
		for (const directory of "home local roaming xdg-data config cache data agent user-data webview tmp".split(
			" ",
		))
			mkdirSync(join(root, directory));
		cpSync(bundle, join(root, "app"), {
			recursive: true,
			filter: (path) => !/\.WebView2$/i.test(path),
		});
		if (interrupted) throw new Error("Interrupted before launch");
		const windows = Object.entries(env).find(([key]) => key.toLowerCase() === "systemroot")?.[1];
		if (!windows) throw new Error("SystemRoot is required");
		const powershell = join(windows, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
		inspector = Bun.spawn(
			[
				powershell,
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				join(import.meta.dir, "src", "windowsChromeProbe.ps1"),
				"-Launcher",
				join(root, "app", relative(bundle, source)),
				"-Sandbox",
				root,
				"-Evidence",
				evidence,
			],
			{
				cwd: root,
				env,
				windowsHide: true,
				stdin: "ignore",
				stdout: Bun.file(join(evidence, "stdout.log")),
				stderr: Bun.file(join(evidence, "stderr.log")),
			},
		);
		async function observe(state: State, label: string, previous?: ChromeSample, reload = false) {
			const minimumDocument = (previous?.chrome.documentCount ?? 1) + (reload ? 1 : 0);
			const deadline = Date.now() + 40_000;
			while (Date.now() < deadline) {
				if (interrupted) throw new Error("Interrupted");
				const shutdown = readJson<unknown>(join(evidence, "shutdown.json"));
				if (shutdown || inspector?.exitCode !== null)
					throw new Error(`Inspector stopped: ${JSON.stringify(shutdown)}`);
				const sample = readJson<ChromeSample>(join(evidence, "native.latest.json"));
				if (
					sample &&
					sample.sequence > (previous?.sequence ?? 0) &&
					measuredState(sample, state, minimumDocument)
				) {
					states.push({ label, sample });
					return sample;
				}
				await Bun.sleep(100);
			}
			throw new Error(
				`No measured ${label} state; inspect native.jsonl (null geometry never passes)`,
			);
		}
		const baseline = await observe("restored", "initial-restored");
		const ready = baseline.ready;
		const origin = new URL(ready.origin);
		if (
			origin.protocol !== "http:" ||
			origin.hostname !== "127.0.0.1" ||
			!origin.port ||
			origin.origin !== ready.origin ||
			ready.mode !== "ui" ||
			ready.windowUrl !== `${ready.origin}/#/v1` ||
			!inside(join(root, "app"), ready.runtimeDir)
		)
			throw new Error("Invalid isolated live-window ready document");
		const health = await fetch(`${ready.origin}/health`, {
			signal: AbortSignal.timeout(10_000),
			redirect: "error",
		});
		const body = await health.text();
		report.health = { status: health.status, body };
		if (!health.ok || body !== "ok") throw new Error("Desktop health failed");
		let last = baseline;
		const baselineGeometry = baseline.chrome.geometry;
		if (!baselineGeometry) throw new Error("Initial restored geometry is unavailable");
		const frameBaselines: Partial<Record<"restored" | "maximized", Rect>> = {
			restored: baseline.native.window,
		};
		const geometryBaselines: Partial<Record<"restored" | "maximized", Geometry>> = {
			restored: baselineGeometry,
		};
		for (const [command, state, label] of [
			["chrome:maximize", "maximized", "maximized"],
			["chrome:fullscreen-on", "fullscreen", "fullscreen-from-maximized"],
			["chrome:reload", "fullscreen", "maximized-fullscreen-reloaded"],
			["chrome:fullscreen-off", "maximized", "maximized-after-fullscreen"],
			["chrome:restore", "restored", "restored-before-fullscreen"],
			["chrome:fullscreen-on", "fullscreen", "fullscreen"],
			["chrome:reload", "fullscreen", "fullscreen-reloaded"],
			["chrome:fullscreen-off", "restored", "final-restored"],
		] as const) {
			if (interrupted) throw new Error("Interrupted");
			writeFileSync(request, command);
			last = await observe(state, label, last, command === "chrome:reload");
			if (
				last.native.dpi !== baseline.native.dpi ||
				!closeRect(last.native.monitor, baseline.native.monitor)
			)
				throw new Error("Display/DPI changed: outside this smoke's scope");
			if (state !== "fullscreen") {
				const geometry = last.chrome.geometry;
				if (!geometry) throw new Error(`${state} geometry is unavailable`);
				const expectedFrame = frameBaselines[state];
				const expectedGeometry = geometryBaselines[state];
				if (expectedFrame && !closeRect(last.native.window, expectedFrame)) {
					throw new Error(`${state} native frame did not return to its measured baseline`);
				}
				if (expectedGeometry && !closeGeometry(geometry, expectedGeometry)) {
					throw new Error(`${state} insets did not return to their measured baseline`);
				}
				frameBaselines[state] ??= last.native.window;
				geometryBaselines[state] ??= geometry;
			}
		}
		report.success = true;
	} catch (error) {
		report.error = String(error);
	} finally {
		try {
			writeFileSync(request, "stop");
		} catch (error) {
			report.success = false;
			report.shutdownRequestError = String(error);
		}
		try {
			if (inspector) {
				if (!(await waitForExit(inspector, 30_000))) {
					report.success = false;
					report.inspectorForced = true;
					report.shutdownError = "Inspector exceeded normal shutdown grace and was terminated";
					inspector.kill("SIGKILL");
					report.inspectorExited = await waitForExit(inspector, 5_000);
				}
				report.inspectorExitCode = inspector.exitCode;
				report.shutdown = readJson(join(evidence, "shutdown.json"));
				if (inspector.exitCode !== 0 || !report.shutdown) {
					report.success = false;
					report.shutdownError ??=
						"Inspector did not complete successfully; see shutdown.json and logs";
				}
			}
		} catch (error) {
			report.success = false;
			report.shutdownError = String(error);
		}
		process.off("SIGINT", stop).off("SIGTERM", stop);
		if (report.success) {
			try {
				removeTree(root);
			} catch (error) {
				report.success = false;
				report.cleanupError = String(error);
			}
		}
		writeFileSync(join(evidence, "result.json"), JSON.stringify(report, null, 2));
	}
	console.log(
		`Candidate state/geometry smoke ${report.success ? "OK" : "FAILED"}; fullParity=false; ${evidence}`,
	);
	if (!report.success) process.exitCode = 1;
}

if (import.meta.main)
	await main().catch((error) => {
		console.error(String(error));
		process.exitCode = 1;
	});
