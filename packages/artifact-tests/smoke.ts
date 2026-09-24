#!/usr/bin/env bun

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { removeTree } from "@thinkrail/shared/removeTree";
import { runDesktopAnalyticsProbe } from "./src/analyticsProbe";
import { locateDesktopLauncher, repoRoot } from "./src/artifact";
import {
	type ArtifactHostAdapter,
	hostEnvironment,
	type RunningArtifactHost,
	runArtifactHostProbes,
} from "./src/artifactProbes";
import { pollUntil, terminateProcess, within } from "./src/lifecycle";

const root = mkdtempSync(join(tmpdir(), "thinkrail-desktop-smoke-"));
let sequence = 0;

function readSettledJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
		throw error;
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

const analyticsOnly = process.argv.includes("--analytics");
const launcher = copyApplication(
	locateDesktopLauncher(
		undefined,
		process.argv.slice(2).find((arg) => arg !== "--analytics"),
	),
);

async function launchDesktop(
	env: Record<string, string>,
	label: string,
	mode: "host" | "ui",
): Promise<
	RunningArtifactHost & { windowUrl: string; mode: string; applicationMenuInstalled: boolean }
> {
	const id = sequence++;
	const readyPath = join(root, `${id}-${label}.ready.json`);
	const controlPath = join(root, `${id}-${label}.control`);
	const navigationProbePath = join(root, `${id}-${label}.navigation.json`);
	const userDataPath = join(root, `${id}-${label}-user-data`);
	const restoredRoute = mode === "ui" ? "#/v1/projects/desktop-smoke" : undefined;
	if (restoredRoute) {
		mkdirSync(userDataPath, { recursive: true });
		writeFileSync(
			join(userDataPath, "routes.json"),
			JSON.stringify({ version: 1, routes: { "local:main": restoredRoute } }),
		);
	}
	const appEnv = hostEnvironment(
		{
			THINKRAIL_DESKTOP_READY_FILE: readyPath,
			THINKRAIL_DESKTOP_CONTROL_FILE: controlPath,
			THINKRAIL_DESKTOP_USER_DATA: userDataPath,
			THINKRAIL_DESKTOP_HIDDEN: "1",
			...(mode === "host"
				? { THINKRAIL_DESKTOP_E2E_HOST: "1" }
				: { THINKRAIL_DESKTOP_NAVIGATION_PROBE_FILE: navigationProbePath }),
		},
		["THINKRAIL_DESKTOP_E2E_HOST", "THINKRAIL_DESKTOP_NAVIGATION_PROBE_FILE"],
		env,
	);
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
		const exitedEarly = (code: number) =>
			new Error(`${label} desktop host exited early with ${code}`);
		let readyDocument: unknown;
		await pollUntil(
			() => {
				readyDocument = readSettledJson(readyPath);
				return readyDocument !== undefined;
			},
			{
				timeoutMs: 30_000,
				what: `${label} desktop ready`,
				exited: proc.exited,
				exitError: exitedEarly,
			},
		);
		const ready = readyDocument as {
			origin: string;
			runtimeDir: string;
			windowUrl: string;
			mode: string;
			applicationMenuInstalled: boolean;
		};
		if (mode === "ui") {
			await pollUntil(
				() => {
					const routes = readSettledJson(join(userDataPath, "routes.json")) as
						| { routes?: Record<string, string> }
						| undefined;
					return routes?.routes?.["local:main"] === "#/v1";
				},
				{
					timeoutMs: 15_000,
					what: "native route preload/RPC round-trip",
					exited: proc.exited,
					exitError: exitedEarly,
				},
			);
			writeFileSync(controlPath, "navigate");
			let navigation: { url?: string } | undefined;
			await pollUntil(
				() => {
					navigation = readSettledJson(navigationProbePath) as { url?: string } | undefined;
					return navigation !== undefined;
				},
				{
					timeoutMs: 15_000,
					what: "native external navigation",
					exited: proc.exited,
					exitError: exitedEarly,
				},
			);
			if (navigation?.url !== "https://example.invalid/thinkrail-navigation-probe") {
				throw new Error(
					`native external navigation reported an unexpected URL: ${navigation?.url}`,
				);
			}
		}
		let stopPromise: Promise<void> | undefined;
		return {
			origin: ready.origin,
			windowUrl: ready.windowUrl,
			mode: ready.mode,
			applicationMenuInstalled: ready.applicationMenuInstalled,
			resources: {
				skillsDir: join(ready.runtimeDir, "skills"),
				trashHelpers: {
					macos: join(ready.runtimeDir, "macos-trash"),
					windows: join(ready.runtimeDir, "windows-trash.exe"),
				},
			},
			stop() {
				stopPromise ??= (async () => {
					try {
						writeFileSync(controlPath, "stop");
						const code = await within(proc.exited, 15_000, `${label} desktop shutdown`);
						if (code !== 0) throw new Error(`${label} desktop shutdown exited ${code}`);
					} catch (error) {
						await terminateProcess(proc, error);
					}
				})();
				return stopPromise;
			},
		};
	} catch (error) {
		await terminateProcess(proc, error);
		throw error;
	}
}

const adapter: ArtifactHostAdapter = {
	name: "electrobun-desktop",
	launch: (env, label) => launchDesktop(env, label, "host"),
};

async function runMutedSmoke(): Promise<void> {
	const isolated = join(root, "ui");
	mkdirSync(isolated, { recursive: true });
	let ui: Awaited<ReturnType<typeof launchDesktop>> | undefined;
	try {
		ui = await launchDesktop(
			hostEnvironment({
				HOME: join(isolated, "home"),
				USERPROFILE: join(isolated, "home"),
				THINKRAIL_DATA_DIR: join(isolated, "data"),
				PI_CODING_AGENT_DIR: join(isolated, "agent"),
				XDG_CACHE_HOME: join(isolated, "cache"),
				THINKRAIL_NO_ANALYTICS: "1",
				CI: "1",
				PI_OFFLINE: "1",
			}),
			"native-ui",
			"ui",
		);
		const health = await within(fetch(`${ui.origin}/health`), 10_000, "desktop UI health");
		if (!health.ok || (await health.text()) !== "ok") throw new Error("desktop UI health failed");
		if (ui.mode !== "ui" || ui.windowUrl !== `${ui.origin}/#/v1/projects/desktop-smoke`) {
			throw new Error(`desktop native window reported an unexpected URL: ${ui.windowUrl}`);
		}
		const applicationMenuExpected = process.platform === "darwin" || process.platform === "win32";
		if (ui.applicationMenuInstalled !== applicationMenuExpected) {
			throw new Error("desktop native application menu registration did not match this platform");
		}
	} finally {
		if (ui) await ui.stop();
	}
	await runArtifactHostProbes(adapter);
	console.log(`smoke OK: ${launcher} passed native-window and shared artifact probes.`);
}

try {
	if (analyticsOnly) await runDesktopAnalyticsProbe(adapter);
	else await runMutedSmoke();
} catch (error) {
	console.error(`desktop smoke FAILED: ${error instanceof Error ? error.message : error}`);
	process.exitCode = 1;
} finally {
	removeTree(root);
}
