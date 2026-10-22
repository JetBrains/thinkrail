import { spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, join, relative, resolve, sep } from "node:path";
import type { BundledExtensions } from "@thinkrail/server";
import type { BuildRuntimeSources } from "@thinkrail/server/build-support";
import { injectChunkId, type SourceMapJson } from "./src/runtimeSourceMap";
import { ptyLibraryName, runtimeTarget } from "./src/runtimeTarget";

const desktopDir = import.meta.dir;
const repoRoot = resolve(desktopDir, "..", "..");
const stageDir = join(desktopDir, ".stage");
const runtimeDir = join(stageDir, "runtime");
const generatedEntry = join(stageDir, "server-entry.ts");
const bundledRuntimeKeys = {
	factories: "factories",
	skillsDir: "skillsDir",
	trashHelpers: "trashHelpers",
	webAccessFactory: "webAccessFactory",
} as const satisfies { [Key in keyof BundledExtensions]-?: Key };

function runBun(args: string[]): void {
	const result = spawnSync("bun", args, { cwd: repoRoot, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`bun ${args.join(" ")} exited ${result.status ?? result.signal}`);
	}
}

function resolveRuntimeSources(): BuildRuntimeSources {
	const result = spawnSync(
		"bun",
		[
			"--print",
			'JSON.stringify((await import("@thinkrail/server/build-support")).resolveBuildRuntimeSources())',
		],
		{ cwd: desktopDir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`build-support manifest exited ${result.status ?? result.signal}`);
	}
	return JSON.parse(result.stdout) as BuildRuntimeSources;
}

function sourceMapRelease(): string | null {
	const release = process.env.THINKRAIL_SOURCEMAPS_RELEASE?.trim();
	if (!release) return null;
	if (!process.env.POSTHOG_CLI_API_KEY || !process.env.POSTHOG_CLI_PROJECT_ID) {
		throw new Error(
			"THINKRAIL_SOURCEMAPS_RELEASE needs POSTHOG_CLI_API_KEY and POSTHOG_CLI_PROJECT_ID",
		);
	}
	return release;
}

function uploadRuntimeSourceMap(runtimeFile: string, release: string): void {
	const mapFile = `${runtimeFile}.map`;
	const injected = injectChunkId(
		readFileSync(runtimeFile, "utf8"),
		JSON.parse(readFileSync(mapFile, "utf8")) as SourceMapJson,
		release,
	);
	writeFileSync(runtimeFile, injected.code);
	rmSync(mapFile);
	const uploadDir = join(stageDir, "sourcemaps");
	mkdirSync(uploadDir, { recursive: true });
	writeFileSync(join(uploadDir, "server-runtime.js"), injected.code);
	writeFileSync(join(uploadDir, "server-runtime.js.map"), JSON.stringify(injected.map));
	try {
		const cli = createRequire(import.meta.url).resolve("@posthog/cli/run-posthog-cli.js");
		runBun([
			cli,
			"sourcemap",
			"upload",
			"--directory",
			uploadDir,
			"--release-name",
			"thinkrail",
			"--release-version",
			release,
			"--release-mode",
			"symbol-set",
		]);
	} finally {
		rmSync(uploadDir, { recursive: true, force: true });
	}
}

function listFiles(root: string): string[] {
	const files: string[] = [];
	for (const name of readdirSync(root)) {
		const path = join(root, name);
		if (statSync(path).isDirectory()) files.push(...listFiles(path));
		else files.push(path);
	}
	return files;
}

const release = sourceMapRelease();
runBun(["run", "build:web"]);
const webMaps = listFiles(join(repoRoot, "apps", "web", "dist")).filter((file) =>
	file.endsWith(".map"),
);
if (webMaps.length) throw new Error(`refusing to package web source maps: ${webMaps.join(", ")}`);
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(runtimeDir, { recursive: true });
const sources = resolveRuntimeSources();
const skillRoutes = new Set<string>();
for (const skillRoot of sources.skillRoots) {
	for (const source of listFiles(skillRoot).sort()) {
		const route = relative(skillRoot, source).split(sep).join("/");
		if (skillRoutes.has(route)) throw new Error(`duplicate staged skill route: ${route}`);
		skillRoutes.add(route);
		const destination = join(runtimeDir, "skills", route);
		mkdirSync(join(destination, ".."), { recursive: true });
		copyFileSync(source, destination);
	}
}
const target = runtimeTarget(process.platform, process.arch);
copyFileSync(sources.ptyLibraries[target], join(runtimeDir, ptyLibraryName(target)));
for (const helper of Object.values(sources.trashHelpers)) {
	copyFileSync(helper, join(runtimeDir, basename(helper)));
}
if (process.platform !== "win32") chmodSync(join(runtimeDir, "macos-trash"), 0o755);

try {
	writeFileSync(
		generatedEntry,
		`${sources.extensions.map((extension, index) => `import factory${index} from ${JSON.stringify(extension.entry)};`).join("\n")}
import { bootHost, registerBundledRuntime, reportDesktopError } from "@thinkrail/server";

export async function startDesktopHost(options) {
  await registerBundledRuntime({
    ${bundledRuntimeKeys.factories}: [${sources.extensions.map((_, index) => `factory${index}`).join(", ")}],
    ${bundledRuntimeKeys.skillsDir}: options.runtimeDir + "/skills",
    ${bundledRuntimeKeys.trashHelpers}: {
      macos: options.runtimeDir + "/macos-trash",
      windows: options.runtimeDir + "/windows-trash.exe",
    },
    ${bundledRuntimeKeys.webAccessFactory}: factory${sources.webAccessIndex},
  });
  const host = await bootHost({
    port: 0,
    host: "127.0.0.1",
    portMode: "exact",
    resolveShellEnv: true,
    staticDir: options.staticDir,
    appVersion: options.appVersion,
    analytics: {
      posthogApiKey: options.posthogProjectKey,
      channel: options.channel,
      build: "desktop",
      appRoot: options.runtimeDir + "/..",
      ...(options.openExternal ? { openExternal: options.openExternal } : {}),
    },
  });
  return { ...host, reportError: reportDesktopError };
}
`,
	);
	const runtimeFile = join(runtimeDir, "server-runtime.ts");
	runBun([
		"build",
		generatedEntry,
		"--target=bun",
		"--define",
		"PI_BUNDLED_NODE=true",
		...(release ? ["--sourcemap=external"] : []),
		`--outdir=${runtimeDir}`,
		`--entry-naming=${basename(runtimeFile)}`,
	]);
	if (release) uploadRuntimeSourceMap(runtimeFile, release);
} finally {
	rmSync(generatedEntry, { force: true });
}
