#!/usr/bin/env bun

import {
	chmodSync,
	copyFileSync,
	cpSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { resolveBuildRuntimeSources } from "@thinkrail/server/build-support";
import { version } from "@thinkrail/shared/version";
import { ptyLibraryName, runtimeTarget } from "./src/runtimeTarget";

const desktopDir = import.meta.dir;
const repoRoot = resolve(desktopDir, "..", "..");
const stageDir = join(desktopDir, ".stage");
const runtimeDir = join(stageDir, "runtime");
const webDir = join(stageDir, "web");
const generatedEntry = join(stageDir, "server-entry.ts");
const environment = process.argv.find((value) => value.startsWith("--env="))?.slice(6) ?? "dev";
const shouldRun = process.argv.includes("--run");
process.env.THINKRAIL_DESKTOP_VERSION = version;
if (!new Set(["dev", "canary", "stable"]).has(environment)) {
	throw new Error(`unsupported Electrobun environment: ${environment}`);
}
if (shouldRun && environment !== "dev") throw new Error("--run is available only for dev builds");

function listFiles(root: string): string[] {
	const files: string[] = [];
	for (const name of readdirSync(root)) {
		const path = join(root, name);
		if (statSync(path).isDirectory()) files.push(...listFiles(path));
		else files.push(path);
	}
	return files;
}

function stageSkills(roots: string[]): void {
	const destination = join(runtimeDir, "skills");
	const routes = new Set<string>();
	for (const root of roots) {
		for (const source of listFiles(root).sort()) {
			const route = relative(root, source).split(sep).join("/");
			if (routes.has(route)) throw new Error(`duplicate staged skill route: ${route}`);
			routes.add(route);
			const target = join(destination, route);
			mkdirSync(join(target, ".."), { recursive: true });
			copyFileSync(source, target);
		}
	}
}

async function buildBundles(): Promise<void> {
	const sources = resolveBuildRuntimeSources();
	const factoryImports = sources.extensions
		.map((extension, index) => `import factory${index} from ${JSON.stringify(extension.entry)};`)
		.join("\n");
	writeFileSync(
		generatedEntry,
		`${factoryImports}
import { bootHost, registerBundledRuntime } from "@thinkrail/server";

export async function startDesktopHost(options) {
  await registerBundledRuntime({
    factories: [${sources.extensions.map((_, index) => `factory${index}`).join(", ")}],
    skillsDir: options.runtimeDir + "/skills",
    trashHelpers: {
      macos: options.runtimeDir + "/macos-trash",
      windows: options.runtimeDir + "/windows-trash.exe",
    },
  });
  return bootHost({
    port: 0,
    host: "127.0.0.1",
    portMode: "exact",
    staticDir: options.staticDir,
    appVersion: options.appVersion,
    analytics: { channel: options.channel, build: "desktop" },
  });
}
`,
	);
	const [serverResult, preloadResult] = await Promise.all([
		Bun.build({
			entrypoints: [generatedEntry],
			outdir: runtimeDir,
			naming: "server-runtime.ts",
			target: "bun",
			sourcemap: "none",
		}),
		Bun.build({
			entrypoints: [join(desktopDir, "src", "preload.ts")],
			outdir: runtimeDir,
			naming: "preload.js",
			target: "browser",
			sourcemap: "none",
		}),
	]);
	if (!serverResult.success) {
		throw new Error(serverResult.logs.map((log) => log.message).join("\n"));
	}
	if (!preloadResult.success) {
		throw new Error(preloadResult.logs.map((log) => log.message).join("\n"));
	}
}

async function stage(): Promise<void> {
	rmSync(stageDir, { recursive: true, force: true });
	mkdirSync(runtimeDir, { recursive: true });
	const webDist = join(repoRoot, "apps", "web", "dist");
	cpSync(webDist, webDir, { recursive: true });
	const sources = resolveBuildRuntimeSources();
	stageSkills(
		sources.extensions.flatMap((extension) => (extension.skills ? [extension.skills] : [])),
	);
	const target = runtimeTarget(process.platform, process.arch);
	const ptyName = ptyLibraryName(target);
	copyFileSync(sources.ptyLibraries[target], join(runtimeDir, ptyName));
	copyFileSync(sources.trashHelpers.macos, join(runtimeDir, basename(sources.trashHelpers.macos)));
	copyFileSync(
		sources.trashHelpers.windows,
		join(runtimeDir, basename(sources.trashHelpers.windows)),
	);
	if (process.platform !== "win32") chmodSync(join(runtimeDir, "macos-trash"), 0o755);
	await buildBundles();
}

function electrobun(...args: string[]): void {
	const result = Bun.spawnSync([process.execPath, "x", "electrobun", ...args], {
		cwd: desktopDir,
		env: { ...process.env, THINKRAIL_DESKTOP_VERSION: version },
		stdout: "inherit",
		stderr: "inherit",
	});
	if (!result.success) throw new Error(`Electrobun ${args.join(" ")} exited ${result.exitCode}`);
}

try {
	await stage();
	electrobun("build", `--env=${environment}`);
	if (shouldRun) electrobun("run");
} finally {
	rmSync(stageDir, { recursive: true, force: true });
}
