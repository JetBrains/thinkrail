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
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
	type ArtifactHostAdapter,
	type RunningArtifactHost,
	runArtifactHostProbes,
} from "@thinkrail/server/artifact-probes";

const desktopDir = import.meta.dir;
const repoRoot = resolve(desktopDir, "..", "..");
const root = mkdtempSync(join(tmpdir(), "thinkrail-desktop-smoke-"));
let sequence = 0;

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${what}`)), ms),
		),
	]);
}

function locateLauncher(): string {
	const explicit = process.argv[2];
	if (explicit) return resolve(explicit);
	const os =
		process.platform === "darwin" ? "macos" : process.platform === "win32" ? "win" : "linux";
	const name = process.platform === "win32" ? "launcher.exe" : "launcher";
	const matches = globSync(join(desktopDir, "build", `dev-${os}-${process.arch}`, "**", name));
	const launcher = matches.find((path) =>
		process.platform === "darwin"
			? path.includes(".app/Contents/MacOS/")
			: path.includes(`${sep}bin${sep}`),
	);
	if (!launcher)
		throw new Error("packaged desktop launcher not found — run `bun run desktop:build` first");
	return launcher;
}

function copyApplication(launcher: string): string {
	const bundleRoot =
		process.platform === "darwin"
			? dirname(dirname(dirname(launcher)))
			: dirname(dirname(launcher));
	const copiedRoot = join(root, basename(bundleRoot));
	cpSync(bundleRoot, copiedRoot, { recursive: true });
	return join(copiedRoot, relative(bundleRoot, launcher));
}

const launcher = copyApplication(locateLauncher());

async function launchDesktop(
	env: Record<string, string>,
	label: string,
	mode: "host" | "ui",
): Promise<RunningArtifactHost & { windowUrl: string; mode: string }> {
	const id = sequence++;
	const readyPath = join(root, `${id}-${label}.ready.json`);
	const controlPath = join(root, `${id}-${label}.control`);
	const appEnv = {
		...env,
		THINKRAIL_DESKTOP_READY_FILE: readyPath,
		THINKRAIL_DESKTOP_CONTROL_FILE: controlPath,
		THINKRAIL_DESKTOP_USER_DATA: join(root, `${id}-${label}-user-data`),
		THINKRAIL_DESKTOP_HIDDEN: "1",
		...(mode === "host" ? { THINKRAIL_DESKTOP_E2E_HOST: "1" } : {}),
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
			runtimeDir: string;
			windowUrl: string;
			mode: string;
		};
		let stopped = false;
		return {
			origin: ready.origin,
			windowUrl: ready.windowUrl,
			mode: ready.mode,
			resources: {
				skillsDir: join(ready.runtimeDir, "skills"),
				trashHelpers: {
					macos: join(ready.runtimeDir, "macos-trash"),
					windows: join(ready.runtimeDir, "windows-trash.exe"),
				},
			},
			async stop() {
				if (stopped) return;
				stopped = true;
				writeFileSync(controlPath, "stop");
				const code = await within(proc.exited, 15_000, `${label} desktop shutdown`);
				if (code !== 0) throw new Error(`${label} desktop shutdown exited ${code}`);
			},
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

try {
	const isolated = join(root, "ui");
	mkdirSync(isolated, { recursive: true });
	let ui: Awaited<ReturnType<typeof launchDesktop>> | undefined;
	try {
		ui = await launchDesktop(
			{
				...Object.fromEntries(
					Object.entries(process.env).filter(
						(entry): entry is [string, string] => entry[1] !== undefined,
					),
				),
				HOME: join(isolated, "home"),
				THINKRAIL_DATA_DIR: join(isolated, "data"),
				PI_CODING_AGENT_DIR: join(isolated, "agent"),
				XDG_CACHE_HOME: join(isolated, "cache"),
				THINKRAIL_NO_ANALYTICS: "1",
				PI_OFFLINE: "1",
			},
			"native-ui",
			"ui",
		);
		const health = await within(fetch(`${ui.origin}/health`), 10_000, "desktop UI health");
		if (!health.ok || (await health.text()) !== "ok") throw new Error("desktop UI health failed");
		if (ui.mode !== "ui" || !ui.windowUrl.startsWith(ui.origin)) {
			throw new Error(`desktop native window reported an unexpected URL: ${ui.windowUrl}`);
		}
	} finally {
		if (ui) await ui.stop();
	}
	await runArtifactHostProbes(adapter);
	console.log(`smoke OK: ${launcher} passed native-window and shared artifact probes.`);
} catch (error) {
	console.error(`desktop smoke FAILED: ${error instanceof Error ? error.message : error}`);
	process.exitCode = 1;
} finally {
	rmSync(root, { recursive: true, force: true });
}
