import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { build, rolldown } from "rolldown";
import { dts } from "rolldown-plugin-dts";
import { hostModuleSource, hostRuntimeSource, stubFileName } from "../src/builder/hostModules";
import { SHARED_SPECIFIERS, type SharedModulesManifest, UI_MODULES } from "../src/shared";
import { MANIFEST_FILE } from "./generate";

const root = resolve(import.meta.dir, "..");
const LOCALES_STUB = join(root, "src/types/locales.d.ts");
const RUNTIME_DEPENDENCIES = /^(?:node:|rolldown(?:$|\/)|tailwindcss(?:$|\/)|@tailwindcss\/)/;
const PEERS = /^(?:react(?:$|\/)|react-dom(?:$|\/)|@earendil-works\/)/;

const REACT = /^(?:react|react-dom)(?:$|\/)/;

async function declarations(
	dist: string,
	input: Record<string, string>,
	external: RegExp,
): Promise<void> {
	const bundle = await rolldown({
		input,
		cwd: root,
		external,
		plugins: [
			{
				name: "thinkrail-locales-stub",
				resolveId: {
					order: "pre",
					handler: (source) =>
						source === "@thinkrail/locales" || source === "@thinkrail/locales/react"
							? LOCALES_STUB
							: null,
				},
			},
			dts({ dtsOnly: true, tsconfig: "tsconfig.dts.json", generator: "tsgo" }),
		],
	});
	await bundle.write({
		dir: dist,
		format: "es",
		chunkFileNames: "types/chunks/[name].d.ts",
	});
	await bundle.close();
}

async function javascript(dist: string): Promise<void> {
	await build({
		cwd: root,
		input: { server: join(root, "src/server.ts"), cli: join(root, "src/cli.ts") },
		platform: "node",
		tsconfig: false,
		external: (id) => RUNTIME_DEPENDENCIES.test(id) || PEERS.test(id),
		output: {
			dir: dist,
			format: "esm",
			chunkFileNames: "chunks/[name]-[hash].js",
		},
		write: true,
	});
}

function hostStubs(dist: string): void {
	const manifest = JSON.parse(readFileSync(MANIFEST_FILE, "utf8")) as SharedModulesManifest;
	const hostDir = join(dist, "host");
	mkdirSync(hostDir, { recursive: true });
	writeFileSync(join(hostDir, "runtime.js"), hostRuntimeSource(manifest.api));
	for (const specifier of SHARED_SPECIFIERS) {
		const file = stubFileName(specifier);
		if (!file) continue;
		const path = join(hostDir, file);
		mkdirSync(dirname(path), { recursive: true });
		const runtime = file.includes("/") ? "../runtime.js" : "./runtime.js";
		writeFileSync(path, hostModuleSource(manifest, specifier, runtime));
	}
}

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : [path];
	});
}

const NODE_REFERENCE = /^\/\/\/ <reference types="node" \/>\n/m;

function assertPortable(dist: string): void {
	const leaks: string[] = [];
	for (const path of files(dist)) {
		let code = readFileSync(path, "utf8");
		if (path.endsWith(".d.ts") && NODE_REFERENCE.test(code)) {
			code = code.replace(NODE_REFERENCE, "");
			writeFileSync(path, code);
		}
		if (/^\/\/\/ <reference/m.test(code)) leaks.push(`${path}: triple-slash reference`);
		if (/from\s*["']@thinkrail\/(?!extension-sdk)/.test(code))
			leaks.push(`${path}: private import`);
		if (/declare global\b/.test(code)) leaks.push(`${path}: declares globals`);
	}
	if (leaks.length > 0) throw new Error(`the packed SDK must stand alone:\n${leaks.join("\n")}`);
}

const typeEntries = ["web", "resources", ...UI_MODULES.map((name) => `ui/${name}`)];

export async function buildDeclarations(dist: string): Promise<void> {
	await declarations(
		dist,
		Object.fromEntries(
			typeEntries.map((name) => [`types/${name}`, join(root, `src/types/${name}.ts`)]),
		),
		REACT,
	);
	await declarations(dist, { server: join(root, "src/server.ts") }, PEERS);
}

export async function buildSdk(dist: string): Promise<number> {
	rmSync(dist, { recursive: true, force: true });
	await buildDeclarations(dist);
	await javascript(dist);
	hostStubs(dist);
	assertPortable(dist);
	return files(dist).length;
}

if (import.meta.main) {
	const count = await buildSdk(join(root, "dist"));
	console.log(`extension-sdk: built ${count} files into dist/`);
}
