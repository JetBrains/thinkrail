#!/usr/bin/env bun
// Outside-the-monorepo gate for the extension SDK and the sample extensions; see packages/extension-sdk/SPEC.md.
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { versionMismatch } from "../packages/extension-sdk/tools/version.ts";
import {
	BUN_ONLY,
	dependenciesFirst,
	EXTENSION_SDK_DIR,
	extensionPackages,
	type PiPackage,
	packPiPackage,
	repoRoot,
} from "./pi-packages.ts";

const TYPESCRIPT_5 = "5.9.3";
const PREFIX = "gate";

const catalog = (
	JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
		workspaces: { catalog: Record<string, string> };
	}
).workspaces.catalog;

function pinned(name: string): string {
	const version = catalog[name];
	if (!version) fail(`${name} is missing from the root catalog`);
	return version;
}

function fail(message: string): never {
	console.error(`check-extension-packages: FAIL — ${message}`);
	process.exit(1);
}

function run(command: string, args: string[], cwd: string, env = process.env): string {
	const result = spawnSync(command, args, {
		cwd,
		env,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.status !== 0) {
		fail(
			`${command} ${args.join(" ")} (in ${cwd}) exited ${result.status}\n${result.stdout}\n${result.stderr}`,
		);
	}
	return result.stdout;
}

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : [path];
	});
}

interface PackedManifest {
	name: string;
	version: string;
	bin?: Record<string, string>;
	exports?: Record<string, string | Record<string, string>>;
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	thinkrail?: Record<string, string>;
}

function extract(tarball: string, scratch: string): { dir: string; manifest: PackedManifest } {
	const target = mkdtempSync(join(scratch, "extract-"));
	run("tar", ["-xzf", tarball, "-C", target], scratch);
	const dir = join(target, "package");
	return { dir, manifest: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) };
}

function assertPackedPackage(pkg: PiPackage, tarball: string, scratch: string, sdkVersion: string) {
	const { dir, manifest } = extract(tarball, scratch);
	const shipped = files(dir).map((path) => relative(dir, path));
	const tests = shipped.filter((path) => /\.test\.[cm]?[jt]sx?$/.test(path));
	if (tests.length > 0) fail(`${pkg.name} ships tests: ${tests.join(", ")}`);
	for (const section of ["dependencies", "peerDependencies"] as const) {
		for (const [name, version] of Object.entries(manifest[section] ?? {})) {
			if (/^(?:workspace|catalog):/.test(version))
				fail(`${pkg.name}: ${section}.${name} was packed as "${version}"`);
		}
	}
	for (const path of shipped.filter((path) => /\.[cm]?js$/.test(path))) {
		const source = readFileSync(join(dir, path), "utf8");
		for (const pattern of BUN_ONLY)
			if (pattern.test(source)) fail(`${pkg.name}: ${path} uses a Bun-only API (${pattern})`);
	}
	const targets = [
		...Object.values(manifest.bin ?? {}),
		...Object.values(manifest.exports ?? {}).flatMap((value) =>
			typeof value === "string" ? [value] : Object.values(value),
		),
		...["server", "web", "styles"].flatMap((key) => manifest.thinkrail?.[key] ?? []),
	];
	for (const target of targets) {
		if (!existsSync(join(dir, target)))
			fail(`${pkg.name} declares ${target}, which it does not ship`);
	}
	if (pkg.dir === EXTENSION_SDK_DIR) {
		const leaked = shipped.filter((path) => /^(?:src|tools)\//.test(path));
		if (leaked.length > 0) fail(`${pkg.name} ships repository sources: ${leaked.join(", ")}`);
		assertApiVersion(manifest.version, sharedApi(dir));
		return;
	}
	if (manifest.dependencies?.["@thinkrail/extension-sdk"] !== sdkVersion) {
		fail(`${pkg.name} must depend on @thinkrail/extension-sdk ${sdkVersion} exactly`);
	}
	const singletons = Object.keys(manifest.dependencies ?? {}).filter((name) =>
		/^(?:@earendil-works\/|typebox$)/.test(name),
	);
	if (singletons.length > 0) fail(`${pkg.name} bundles host singletons: ${singletons.join(", ")}`);
}

function sharedApi(sdkDir: string): string {
	return (
		JSON.parse(readFileSync(join(sdkDir, "assets/shared-modules.json"), "utf8")) as { api: string }
	).api;
}

function assertApiVersion(version: string, api: string): void {
	const mismatch = versionMismatch(version, api);
	if (mismatch !== undefined) fail(mismatch);
}

const SDK_RANGE = /"@thinkrail\/extension-sdk":\s*"([^"]+)"/g;

function assertDocumentedRanges(api: string): void {
	const docs = [
		join(EXTENSION_SDK_DIR, "README.md"),
		...files(join(repoRoot, "packages/server/skills/making-thinkrail-extensions")),
		...readdirSync(join(repoRoot, "extension-examples")).map((name) =>
			join(repoRoot, "extension-examples", name, "README.md"),
		),
	].filter((path) => path.endsWith(".md") && existsSync(path));
	for (const path of docs) {
		for (const match of readFileSync(path, "utf8").matchAll(SDK_RANGE)) {
			const range = match[1];
			if (range !== `~${api}.0` && range !== "~<api>.0")
				fail(
					`${relative(repoRoot, path)} asks for @thinkrail/extension-sdk "${range}": document "~${api}.0", the range of extension API ${api}`,
				);
		}
	}
}

const WEB = `import { RiPaletteLine } from "@remixicon/react";
import { Button, IconButton, withIconClass } from "@thinkrail/extension-sdk/ui/button";
import { onThemeSwap } from "@thinkrail/extension-sdk/ui/theme";
import { cn } from "@thinkrail/extension-sdk/ui/utils";
import { FramedResourcePreview, useOptionalResourceHost, useResourceScope } from "@thinkrail/extension-sdk/resources";
import { defineWebExtension, numArg, resultText, strArg, type ToolRenderProps } from "@thinkrail/extension-sdk/web";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const Glyph = withIconClass(RiPaletteLine, "${PREFIX}:text-primary");

function Card({ args, result, interaction }: ToolRenderProps) {
	const [text, setText] = useState("");
	const scope = useResourceScope();
	const host = useOptionalResourceHost();
	useEffect(() => onThemeSwap(() => setText("")), []);
	return (
		<div className={cn("${PREFIX}:flex ${PREFIX}:gap-8 ${PREFIX}:bg-feedback-info-subtle", text && "${PREFIX}:border")}>
			<Button variant="outline" size="s" iconLeft={Glyph} onClick={() => host?.openFile(scope?.workspaceId ?? "", "a.md")}>
				{strArg(args, "city")} {numArg(args, "days") ?? 0} {resultText(result)}
			</Button>
			<IconButton icon={RiPaletteLine} label="Pick" onClick={() => interaction?.focusComposer()} />
			<textarea className="${PREFIX}:rounded-md" value={text} onChange={(event) => setText(event.target.value)} />
			{scope ? <FramedResourcePreview path="a.md" title="a" frameClassName="${PREFIX}:h-200" testIdPrefix="gate" /> : null}
			{text ? createPortal(<span>{text}</span>, document.body) : null}
		</div>
	);
}

export default defineWebExtension({
	name: "thinkrail-ext-gate",
	toolRenderers: {
		gate_tool: { renderer: Card, options: { prominence: "primary", summary: ({ args }, t) => t("gate") + strArg(args, "city") } },
	},
});
`;

const SERVER = `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineServerExtension } from "@thinkrail/extension-sdk/server";
import { Type } from "typebox";

export default defineServerExtension({
	name: "thinkrail-ext-gate",
	extensions: [
		(pi: ExtensionAPI) => {
			pi.registerTool({
				name: "gate_tool",
				label: "Gate",
				description: "Echo a city.",
				parameters: Type.Object({ city: Type.String() }),
				async execute(_toolCallId, params) {
					return { content: [{ type: "text", text: params.city }], details: {} };
				},
			});
		},
	],
	sessionExtensions: (session) => [() => void session.setting("loud")],
	settings: { loud: { type: "boolean", default: false, title: "Loud", description: "Shout the city." } },
});
`;

const LOADER = `const [bundle, manifestPath, mode] = process.argv.slice(2);
const { readFileSync } = await import("node:fs");
const { pathToFileURL } = await import("node:url");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (mode !== "none") {
	const modules = Object.fromEntries(Object.entries(manifest.modules).map(([specifier, names]) => [specifier, Object.fromEntries(names.map((name) => [name, () => null]))]));
	modules["@thinkrail/extension-sdk/web"].defineWebExtension = (extension) => extension;
	globalThis.__thinkrailExtensionHost = { api: mode, modules };
}
try {
	const loaded = await import(pathToFileURL(bundle).href);
	console.log(JSON.stringify({ name: loaded.default.name, tools: Object.keys(loaded.default.toolRenderers) }));
} catch (error) {
	console.log(JSON.stringify({ error: error.message }));
}
`;

function tsconfig(include: string, skipLibCheck: boolean): string {
	return JSON.stringify({
		compilerOptions: {
			target: "ES2023",
			module: "ESNext",
			moduleResolution: "Bundler",
			lib: ["ES2023", "DOM", "DOM.Iterable"],
			jsx: "react-jsx",
			types: [],
			strict: true,
			noEmit: true,
			verbatimModuleSyntax: true,
			skipLibCheck,
		},
		include: [include],
	});
}

function assertBundle(label: string, path: string): string {
	const bundle = readFileSync(path, "utf8");
	if (!bundle.includes("__thinkrailExtensionHost")) fail(`${label}: no host lookup in ${path}`);
	for (const forbidden of [
		"react.production",
		"Symbol.for(",
		"jsxDEV",
		"radix",
		"tailwind-merge",
		"class-variance-authority",
		"clsx",
	]) {
		if (bundle.includes(forbidden)) fail(`${label}: ${path} contains ${forbidden}`);
	}
	if (/^import\s|[^\w.]import\s*\(/m.test(bundle))
		fail(`${label}: ${path} is not one self-contained file`);
	return bundle;
}

function assertStylesheet(label: string, path: string, prefix: string): void {
	const css = readFileSync(path, "utf8");
	const selectors = [...css.matchAll(/(?:^|[{};])\s*([^{};@]+)\{/g)].map((match) => match[1] ?? "");
	const classes = selectors.flatMap((selector) =>
		[...selector.matchAll(/\.((?:\\.|[\w-])+)/g)].map((match) => match[1] ?? ""),
	);
	if (classes.length === 0) fail(`${label}: ${path} has no utilities`);
	const stray = classes.filter((name) => !name.startsWith(`${prefix}\\:`));
	if (stray.length > 0) fail(`${label}: ${path} has unprefixed classes: ${stray.join(", ")}`);
	if (!css.includes("var(--")) fail(`${label}: ${path} does not read the app's variables`);
}

function assertLoads(fixture: string, bundle: string, manifest: string, name: string): void {
	const loader = join(fixture, "load.mjs");
	const load = (mode: string) =>
		JSON.parse(run("node", [loader, bundle, manifest, mode], fixture)) as {
			name?: string;
			error?: string;
		};
	const loaded = load("1.0");
	if (loaded.name !== name)
		fail(`${bundle} did not load inside a 1.0 host: ${JSON.stringify(loaded)}`);
	if (!load("none").error?.includes("__thinkrailExtensionHost is missing"))
		fail(`${bundle} does not explain a missing host`);
	if (!load("2.0").error?.includes("this ThinkRail provides extension API 2.0"))
		fail(`${bundle} does not refuse another API major`);
}

const packages = dependenciesFirst(extensionPackages());
const sdk = packages.find((pkg) => pkg.dir === EXTENSION_SDK_DIR);
if (!sdk) fail("packages/extension-sdk is missing");
const samples = packages.filter((pkg) => pkg !== sdk);

const scratch = mkdtempSync(join(tmpdir(), "thinkrail-extension-packages-"));
try {
	console.log(
		`check-extension-packages: node ${run("node", ["--version"], repoRoot).trim()}, npm ${run("npm", ["--version"], repoRoot).trim()}, bun ${Bun.version}`,
	);
	assertDocumentedRanges(sharedApi(sdk.dir));
	const tarballs = new Map<PiPackage, string>();
	for (const pkg of packages) {
		const tarball = packPiPackage(pkg, scratch);
		assertPackedPackage(pkg, tarball, scratch, sdk.version);
		tarballs.set(pkg, tarball);
	}

	const fixture = join(scratch, "thinkrail-ext-gate");
	const write = (path: string, content: string) => {
		mkdirSync(dirname(join(fixture, path)), { recursive: true });
		writeFileSync(join(fixture, path), content);
	};
	const devDependencies = Object.fromEntries(
		[
			"react",
			"react-dom",
			"@types/react",
			"@types/react-dom",
			"@remixicon/react",
			"typebox",
			"@earendil-works/pi-coding-agent",
			"typescript",
		].map((name) => [name, pinned(name)]),
	);
	write(
		"package.json",
		JSON.stringify({
			name: "thinkrail-ext-gate",
			version: "1.0.0",
			private: true,
			type: "module",
			keywords: ["thinkrail-extension"],
			thinkrail: {
				api: "1.0",
				server: "./server/index.ts",
				web: "./dist/web.js",
				styles: "./dist/web.css",
				title: "Gate",
			},
			dependencies: Object.fromEntries(
				[...tarballs].map(([pkg, tarball]) => [pkg.name, `file:${tarball}`]),
			),
			peerDependencies: { "@earendil-works/pi-coding-agent": "*", typebox: "*" },
			devDependencies: { ...devDependencies, typescript5: `npm:typescript@${TYPESCRIPT_5}` },
		}),
	);
	write("web/index.tsx", WEB);
	write("server/index.ts", SERVER);
	write("tsconfig.web.json", tsconfig("web", false));
	write("tsconfig.server.json", tsconfig("server", true));
	write("load.mjs", LOADER);
	run(
		"npm",
		["install", "--no-audit", "--no-fund", "--loglevel=error", "--legacy-peer-deps"],
		fixture,
	);
	const sdkDir = join(fixture, "node_modules/@thinkrail/extension-sdk");
	if (!existsSync(join(sdkDir, "dist/cli.js"))) fail("the SDK did not install into the fixture");

	for (const compiler of ["typescript", "typescript5"]) {
		const tsc = join(fixture, "node_modules", compiler, "bin/tsc");
		run("node", [tsc, "-p", "tsconfig.web.json"], fixture);
		run("node", [tsc, "-p", "tsconfig.server.json"], fixture);
	}

	const bin = join(fixture, "node_modules/.bin/thinkrail-extension");
	run("node", [bin, "build", "--prefix", PREFIX], fixture);
	const nodeBundle = assertBundle("Node build", join(fixture, "dist/web.js"));
	assertStylesheet("Node build", join(fixture, "dist/web.css"), PREFIX);
	copyFileSync(join(fixture, "dist/web.css"), join(scratch, "node-web.css"));
	run("bun", [join(sdkDir, "bin/thinkrail-extension.js"), "build", "--prefix", PREFIX], fixture);
	const bunBundle = assertBundle("Bun build", join(fixture, "dist/web.js"));
	if (bunBundle !== nodeBundle) fail("the Bun build differs from the Node build");
	if (
		readFileSync(join(fixture, "dist/web.css"), "utf8") !==
		readFileSync(join(scratch, "node-web.css"), "utf8")
	)
		fail("the Bun stylesheet differs from the Node stylesheet");

	const manifest = join(sdkDir, "assets/shared-modules.json");
	assertLoads(fixture, join(fixture, "dist/web.js"), manifest, "thinkrail-ext-gate");
	const servers = [join(fixture, "server/index.ts")];

	for (const sample of samples) {
		const dir = join(fixture, "node_modules", sample.name);
		const sampleManifest = JSON.parse(
			readFileSync(join(dir, "package.json"), "utf8"),
		) as PackedManifest;
		const web = sampleManifest.thinkrail?.web;
		const styles = sampleManifest.thinkrail?.styles;
		const server = sampleManifest.thinkrail?.server;
		if (web) {
			assertBundle(sample.name, join(dir, web));
			assertLoads(fixture, join(dir, web), manifest, sample.name);
		}
		if (styles) {
			const build =
				(
					JSON.parse(readFileSync(join(sample.dir, "package.json"), "utf8")) as {
						scripts?: { build?: string };
					}
				).scripts?.build ?? "";
			const prefix = /--prefix[= ]([a-z]+)/.exec(build)?.[1];
			if (!prefix) fail(`${sample.name} declares styles but its build script names no --prefix`);
			assertStylesheet(sample.name, join(dir, styles), prefix);
		}
		if (server) servers.push(join(dir, server));
	}

	for (const server of servers) {
		const loaded = run(
			"bun",
			[
				"-e",
				`const d = (await import(${JSON.stringify(server)})).default; console.log(JSON.stringify({ name: d.name, extensions: Array.isArray(d.extensions) }));`,
			],
			fixture,
		);
		const descriptor = JSON.parse(loaded) as { name?: string; extensions?: boolean };
		if (!descriptor.name || descriptor.extensions !== true)
			fail(`${server} does not default-export a server descriptor: ${loaded}`);
	}

	console.log(
		`check-extension-packages: OK (${packages.map((pkg) => pkg.name).join(", ")} packed, installed and built outside the repository under Node and Bun; types checked with TypeScript ${catalog.typescript} and ${TYPESCRIPT_5})`,
	);
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
