import { spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import type { BundledExtensions } from "@thinkrail/server";
import { resolveBuildRuntimeSources } from "@thinkrail/server/build-support";
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

function listFiles(root: string): string[] {
	const files: string[] = [];
	for (const name of readdirSync(root)) {
		const path = join(root, name);
		if (statSync(path).isDirectory()) files.push(...listFiles(path));
		else files.push(path);
	}
	return files;
}

runBun(["run", "build:web"]);
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(runtimeDir, { recursive: true });
const sources = resolveBuildRuntimeSources();
const skillRoutes = new Set<string>();
for (const extension of sources.extensions) {
	if (!extension.skills) continue;
	for (const source of listFiles(extension.skills).sort()) {
		const route = relative(extension.skills, source).split(sep).join("/");
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
import { bootHost, registerBundledRuntime } from "@thinkrail/server";

export async function startDesktopHost(options) {
  await registerBundledRuntime({
    ${bundledRuntimeKeys.factories}: [${sources.extensions.map((_, index) => `factory${index}`).join(", ")}],
    ${bundledRuntimeKeys.skillsDir}: options.runtimeDir + "/skills",
    ${bundledRuntimeKeys.trashHelpers}: {
      macos: options.runtimeDir + "/macos-trash",
      windows: options.runtimeDir + "/windows-trash.exe",
    },
    ${bundledRuntimeKeys.webAccessFactory}: factory0,
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
	runBun([
		"build",
		generatedEntry,
		"--target=bun",
		`--outfile=${join(runtimeDir, "server-runtime.ts")}`,
	]);
} finally {
	rmSync(generatedEntry, { force: true });
}
