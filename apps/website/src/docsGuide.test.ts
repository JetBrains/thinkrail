import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { catalogKeyword } from "./extensionCatalog";
import { packagePath, parseExtensionManifest } from "./extensionManifest";

const repo = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, repo), "utf8");
const readJson = <T>(path: string) => JSON.parse(read(path)) as T;
const roots = {
	palette: "extension-examples/palette/",
	sdk: "packages/extension-sdk/",
} as const;

interface SamplePackage {
	name: string;
	keywords: string[];
	scripts: Record<string, string>;
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
	peerDependencies: Record<string, string>;
	publishConfig: { access: string };
	thinkrail: { api: string; server: string; web: string; styles: string; title: string };
}

const sample = readJson<SamplePackage>(`${roots.palette}package.json`);
const sharedModules = readJson<{ api: string; modules: Record<string, string[]> }>(
	`${roots.sdk}assets/shared-modules.json`,
);
const apiVersion = /^export const EXTENSION_API_VERSION = "([^"]+)";$/m.exec(
	read("packages/extension-api/src/manifest.ts"),
)?.[1];

const pages = ["build-an-extension", "extension-reference"].map((name) => ({
	name,
	text: readFileSync(new URL(`../content/docs/${name}/index.md`, import.meta.url), "utf8"),
}));
const [guide, reference] = pages as [(typeof pages)[number], (typeof pages)[number]];

interface Fence {
	page: string;
	lang: string;
	body: string;
	guard: string | undefined;
}

const guardLine = /^<!-- guard: (.+) -->$/;

function fences(page: (typeof pages)[number]): Fence[] {
	const lines = page.text.split("\n");
	const found: Fence[] = [];
	for (let index = 0; index < lines.length; index++) {
		const open = /^```(\w*)$/.exec(lines[index] as string);
		if (!open) continue;
		const end = lines.indexOf("```", index + 1);
		if (end < 0) throw new Error(`${page.name}: unclosed code block at line ${index + 1}`);
		found.push({
			page: page.name,
			lang: open[1] as string,
			body: lines.slice(index + 1, end).join("\n"),
			guard: guardLine.exec(lines[index - 1] ?? "")?.[1],
		});
		index = end;
	}
	return found;
}

const allFences = pages.flatMap(fences);

function guarded(kind: string): Fence[] {
	return allFences.filter((fence) => fence.guard?.split(" ")[0] === kind);
}

function guardedLines(page: (typeof pages)[number], guard: string): string[] {
	const lines = page.text.split("\n");
	const start = lines.indexOf(`<!-- guard: ${guard} -->`);
	if (start < 0) throw new Error(`${page.name} has no "${guard}" guard`);
	const end = lines.indexOf("", start);
	return lines.slice(start + 1, end < 0 ? undefined : end);
}

function tableRows(page: (typeof pages)[number], guard: string): string[][] {
	return guardedLines(page, guard)
		.slice(2)
		.map((row) =>
			row
				.replace(/^\||\|$/g, "")
				.split("|")
				.map((cell) => cell.trim()),
		);
}

const codeSpans = (text: string) =>
	[...text.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string);

function interfaceKeys(path: string, name: string): string[] {
	const body = new RegExp(`export interface ${name}(?:<[^>]*>)? \\{\\n([\\s\\S]*?)\\n\\}`).exec(
		read(path),
	)?.[1];
	if (body === undefined) throw new Error(`${path} has no interface ${name}`);
	return [...body.matchAll(/^\t(\w+)\??[:(]/gm)].map((match) => match[1] as string);
}

function sourcePath(guard: string): string {
	const [root, ...rest] = guard.split("/");
	if (root !== "palette" && root !== "sdk") throw new Error(`unknown guard root in "${guard}"`);
	return `${roots[root]}${rest.join("/")}`;
}

function dedent(lines: string[]): string[] {
	const indents = lines
		.filter((line) => line.trim() !== "")
		.map((line) => (/^\s*/.exec(line) as RegExpExecArray)[0].length);
	const cut = Math.min(...indents);
	return lines.map((line) => line.slice(cut));
}

function isContiguousSlice(excerpt: string, file: string): boolean {
	const wanted = excerpt.split("\n");
	const lines = file.replace(/\n$/, "").split("\n");
	for (let start = 0; start + wanted.length <= lines.length; start++) {
		if (dedent(lines.slice(start, start + wanted.length)).join("\n") === wanted.join("\n")) {
			return true;
		}
	}
	return false;
}

const cliOptions = (() => {
	const block = /options: \{\n([\s\S]*?)\n\t\t\},/.exec(read(`${roots.sdk}src/cli.ts`))?.[1] ?? "";
	const flags = new Set<string>();
	for (const match of block.matchAll(/^\t+(\w+): \{ ([^}]*)\}/gm)) {
		const [, name, spec] = match as unknown as [string, string, string];
		flags.add(/default: true/.test(spec) ? `--no-${name}` : `--${name}`);
		const short = /short: "(\w)"/.exec(spec)?.[1];
		if (short) flags.add(`-${short}`);
	}
	return flags;
})();

function commandFlags(text: string): string[] {
	return [...text.matchAll(/thinkrail-extension build([^`\n]*)/g)].flatMap((match) =>
		[...(match[1] as string).matchAll(/(?:^|\s)\[?(-{1,2}[a-z-]+)/g)].map(
			(flag) => flag[1] as string,
		),
	);
}

describe("the docs' code blocks", () => {
	test("every code block names the source that guards it", () => {
		const unguarded = allFences.filter((fence) => fence.guard === undefined);
		expect(unguarded.map((fence) => `${fence.page}: ${fence.body.split("\n")[0]}`)).toEqual([]);
		const kinds = new Set([
			"file",
			"excerpt",
			"package-json",
			"tree",
			"shell",
			"extensions-json",
			"manifest-cases",
		]);
		for (const fence of allFences) expect(kinds).toContain(fence.guard?.split(" ")[0] as string);
	});

	test.each(guarded("file").map((fence) => [fence.guard as string, fence] as const))(
		"%s shows the whole file",
		(guard, fence) => {
			const file = read(sourcePath(guard.split(" ")[1] as string));
			expect(fence.body).toBe(file.replace(/\n$/, ""));
		},
	);

	test.each(
		guarded("excerpt").map((fence, index) => [`${fence.guard} #${index + 1}`, fence] as const),
	)("%s is a contiguous slice of the file", (_label, fence) => {
		const file = read(sourcePath((fence.guard as string).split(" ")[1] as string));
		expect(fence.body.split("\n").length).toBeGreaterThan(1);
		expect(isContiguousSlice(fence.body, file)).toBe(true);
	});

	test("the package.json excerpt copies the sample's fields verbatim and is a valid manifest", () => {
		const [fence] = guarded("package-json");
		expect(fence?.guard).toBe("package-json palette/package.json");
		const shown = JSON.parse(fence?.body ?? "") as Record<string, unknown>;
		expect(fence?.body).toBe(JSON.stringify(shown, null, "\t"));
		const fileKeys = Object.keys(sample);
		const keys = Object.keys(shown);
		expect(keys).toEqual(fileKeys.filter((key) => keys.includes(key)));
		for (const key of keys) expect(shown[key]).toEqual(sample[key as keyof SamplePackage]);
		expect(keys).toEqual(expect.arrayContaining(["name", "keywords", "thinkrail", "scripts"]));
		expect(parseExtensionManifest(shown).ok).toBe(true);
		expect(sample.keywords).toContain(catalogKeyword);
		expect(sample.thinkrail.api).toBe(apiVersion as string);
		expect(guide.text).toContain(`"api": "${apiVersion}"`);
	});

	test("the package tree lists the sample's sources and the build outputs", () => {
		const [fence] = guarded("tree");
		const lines = (fence?.body ?? "").split("\n");
		expect(lines[0]).toBe("palette/");
		const stack: string[] = [];
		const leaves: string[] = [];
		for (const line of lines.slice(1)) {
			const match = /^((?:│ {3}| {4})*)[├└]── (\S+)/.exec(line);
			if (!match) throw new Error(`not a tree row: ${line}`);
			const depth = (match[1] as string).length / 4;
			stack.length = depth;
			stack.push(match[2] as string);
			if (!(match[2] as string).endsWith("/")) leaves.push(stack.join(""));
		}
		const built = [sample.thinkrail.web, sample.thinkrail.styles].map((path) => packagePath(path));
		for (const leaf of leaves) {
			if (leaf.startsWith("dist/")) expect(built).toContain(leaf);
			else expect(existsSync(new URL(`${roots.palette}${leaf}`, repo))).toBe(true);
		}
		for (const path of built) expect(leaves).toContain(path as string);
		for (const folder of ["server", "web"]) {
			for (const file of readdirSync(new URL(`${roots.palette}${folder}/`, repo))) {
				if (!file.endsWith(".test.ts")) expect(leaves).toContain(`${folder}/${file}`);
			}
		}
		expect(packagePath(sample.thinkrail.server)).toBe("server/index.ts");
	});

	test("shell commands use the sample's scripts and packages and the build command's real options", () => {
		for (const fence of guarded("shell")) {
			for (const line of fence.body.split("\n")) {
				const words = line.trim().split(/\s+/);
				if (words[0] === "npm" && words[1] === "run") {
					expect(Object.keys(sample.scripts)).toContain(words[2] as string);
				} else if (words[0] === "npm" && words[1] === "install") {
					const dev = words.includes("--save-dev");
					const declared = dev ? sample.devDependencies : sample.dependencies;
					for (const name of words.slice(2).filter((word) => !word.startsWith("-"))) {
						expect(Object.keys(declared)).toContain(name);
					}
				} else if (words[0] === "npm" && words[1] === "publish") {
					expect(words.slice(2)).toEqual(["--access", sample.publishConfig.access]);
				} else if (words[0] !== "thinkrail-extension") {
					throw new Error(`unguarded command in ${fence.page}: ${line}`);
				}
			}
		}
	});

	test("every thinkrail-extension build option the docs name exists in the CLI", () => {
		const flags = pages.flatMap((page) => commandFlags(page.text));
		expect(flags.length).toBeGreaterThan(0);
		for (const flag of flags) expect(cliOptions).toContain(flag);
		expect(guide.text).toContain(sample.scripts.build as string);
		for (const page of pages) {
			for (const flag of page.text.matchAll(/`(--[a-z-]+)(?: <\w+>)?`/g)) {
				expect(cliOptions).toContain(flag[1] as string);
			}
		}
	});

	test("the extensions.json examples are absolute folders or npm sources in a lone extensions list", () => {
		const blocks = guarded("extensions-json");
		expect(blocks.length).toBeGreaterThan(0);
		for (const fence of blocks) {
			const parsed = JSON.parse(fence.body) as Record<string, unknown>;
			expect(Object.keys(parsed)).toEqual(["extensions"]);
			for (const source of parsed.extensions as unknown[]) {
				expect(typeof source).toBe("string");
				expect(/^(?:npm:.+|\/.+|~\/.+)$/.test(source as string)).toBe(true);
			}
		}
		const declarations = read("packages/server/src/extensions/installed/runtime.ts");
		expect(declarations).toContain('join(options.dataDir, "extensions.json")');
	});

	test("the manifest cases follow the host's table and hold under the site's validator", () => {
		const hostCases = readJson<Record<string, unknown>[]>(
			"packages/extension-api/src/manifestCases.json",
		);
		const shape = Object.keys(hostCases[0] ?? {}).sort();
		for (const entry of hostCases) expect(Object.keys(entry).sort()).toEqual(shape);
		const [fence] = guarded("manifest-cases");
		const cases = JSON.parse(fence?.body ?? "") as {
			label: string;
			packageJson: unknown;
			valid: boolean;
		}[];
		expect(cases.some((entry) => entry.valid)).toBe(true);
		expect(cases.some((entry) => !entry.valid)).toBe(true);
		for (const entry of cases) {
			expect(Object.keys(entry).sort()).toEqual(shape);
			expect([entry.label, parseExtensionManifest(entry.packageJson).ok]).toEqual([
				entry.label,
				entry.valid,
			]);
		}
	});
});

describe("the docs' reference tables", () => {
	const firstColumn = (guard: string) =>
		tableRows(reference, guard).map((row) => codeSpans(row[0] as string));

	test("the manifest fields are the build's manifest keys", () => {
		const keys = /const MANIFEST_KEYS = \[([^\]]+)\]/.exec(
			read(`${roots.sdk}src/builder/manifest.ts`),
		)?.[1];
		const expected = [...(keys ?? "").matchAll(/"(\w+)"/g)].map((match) => match[1]);
		expect(firstColumn("manifest-fields").map((spans) => spans[0])).toEqual(expected);
	});

	test("the server descriptor and session services match the SDK's types", () => {
		expect(firstColumn("server-descriptor").map((spans) => spans[0])).toEqual(
			interfaceKeys(`${roots.sdk}src/server.ts`, "ServerExtension"),
		);
		const services = firstColumn("session-services").map((spans) =>
			(spans[0] as string).replace(/\(.*$/, ""),
		);
		expect(services.sort()).toEqual(
			interfaceKeys(`${roots.sdk}src/server.ts`, "ExtensionSessionServices").sort(),
		);
	});

	test("the render props and registration options match the web contract the SDK re-exports", () => {
		expect(read(`${roots.sdk}src/types/web.ts`).trim()).toBe(
			'export * from "@thinkrail/extension-api/web";',
		);
		const web = "packages/extension-api/src/web.ts";
		expect(firstColumn("render-props").map((spans) => spans[0])).toEqual(
			interfaceKeys(web, "ToolRenderProps"),
		);
		expect(firstColumn("registration-options").map((spans) => spans[0])).toEqual(
			interfaceKeys(web, "ToolRegistrationOptions"),
		);
	});

	test("the shared modules are the SDK's shared-module manifest, in order, with every export", () => {
		const items = guardedLines(reference, "shared-modules").map((line) => {
			const match = /^- `([^`]+)`: (.+)$/.exec(line);
			if (!match) throw new Error(`not a shared-module item: ${line}`);
			return [match[1] as string, match[2] as string] as const;
		});
		expect(items.map(([specifier]) => specifier)).toEqual(Object.keys(sharedModules.modules));
		for (const [specifier, exports] of items) {
			if (specifier.startsWith("@thinkrail/")) {
				expect(codeSpans(exports)).toEqual(sharedModules.modules[specifier] as string[]);
			}
		}
		expect(sharedModules.api).toBe(apiVersion as string);
	});

	test("the guide's summary of the shared modules names every one of them", () => {
		const spans = codeSpans(guardedLines(guide, "shared-modules-summary").join("\n"));
		const named = new Set<string>();
		for (const span of spans) {
			if (/^(?:react|@thinkrail\/)/.test(span)) named.add(span);
		}
		const uiPrefix = "@thinkrail/extension-sdk/ui/<module>";
		expect(named.has(uiPrefix)).toBe(true);
		const uiModules = spans
			.slice(spans.indexOf(uiPrefix) + 1)
			.filter((span) => /^[a-z-]+$/.test(span));
		const expected = Object.keys(sharedModules.modules);
		for (const specifier of expected) {
			const ui = /^@thinkrail\/extension-sdk\/ui\/(.+)$/.exec(specifier)?.[1];
			if (ui) expect(uiModules).toContain(ui);
			else expect(named).toContain(specifier);
		}
		const exports = new Set(Object.values(sharedModules.modules).flat());
		for (const name of uiModules) {
			if (!exports.has(name)) expect(expected).toContain(`@thinkrail/extension-sdk/ui/${name}`);
		}
	});

	test("the build options are exactly the CLI's options, with its default entries", () => {
		const rows = tableRows(reference, "build-options");
		const flags = rows.flatMap((row) =>
			codeSpans(row[0] as string).map((span) => span.replace(/ <\w+>$/, "")),
		);
		expect(new Set(flags)).toEqual(cliOptions);
		const defaults = /export const DEFAULT_ENTRIES = \[([^\]]+)\]/.exec(
			read(`${roots.sdk}src/builder/index.ts`),
		)?.[1];
		const entryRow = rows.find((row) => (row[0] as string).includes("--entry"));
		for (const entry of (defaults ?? "").matchAll(/"([^"]+)"/g)) {
			expect(codeSpans(entryRow?.[1] as string)).toContain(entry[1] as string);
		}
	});
});

describe("the guide's facts about the sample and the SDK", () => {
	test("links the sample's source folder, which exists", () => {
		expect(guide.text).toContain(
			"https://github.com/JetBrains/thinkrail/tree/main/extension-examples/palette",
		);
		expect(guide.text).toContain(`npm:${sample.name}`);
	});

	test("names the built-in extensions whose names are reserved", () => {
		const listed = /built-in extension\s*\(([^)]*)\)/.exec(guide.text.replace(/\n/g, " "))?.[1];
		const builtins = readdirSync(new URL("thinkrail-extensions/", repo))
			.filter((folder) =>
				existsSync(new URL(`thinkrail-extensions/${folder}/server/index.ts`, repo)),
			)
			.map(
				(folder) =>
					/^\tname: "([^"]+)",$/m.exec(read(`thinkrail-extensions/${folder}/server/index.ts`))?.[1],
			);
		expect(codeSpans(listed ?? "").sort()).toEqual(builtins.sort() as string[]);
	});

	test("quotes utilities, classes, the tool and the setting the sample really uses", () => {
		const web = ["web/index.tsx", "web/PaletteCard.tsx"]
			.map((file) => read(`${roots.palette}${file}`))
			.join("\n");
		const server = read(`${roots.palette}server/index.ts`);
		for (const span of codeSpans(guide.text)) {
			if (/^palette:[\w-]+$/.test(span) || /^tr-[\w-]+$/.test(span)) expect(web).toContain(span);
		}
		expect(server).toContain('export const PALETTE_TOOL = "color_palette";');
		expect(web).toContain("color_palette: {");
		expect(server).toContain('title: "Rate contrast"');
		expect(guide.text).toContain("**Rate contrast**");
	});

	test("states the SDK's Node floor", () => {
		const engines = readJson<{ engines: { node: string } }>(`${roots.sdk}package.json`).engines;
		expect(engines.node).toBe(">=22.19");
		expect(guide.text).toContain("Node 22.19 or newer");
	});
});

describe("the docs' links between sections", () => {
	const slug = (heading: string) =>
		heading
			.toLowerCase()
			.replace(/[^a-z0-9 -]/g, "")
			.replace(/ /g, "-");
	const anchors = new Map(
		pages.map((page) => [
			page.name,
			new Set([...page.text.matchAll(/^#{2,4} (.+)$/gm)].map((match) => slug(match[1] as string))),
		]),
	);

	test.each(pages.map((page) => [page.name, page] as const))(
		"%s links only to headings that exist",
		(_name, page) => {
			for (const match of page.text.matchAll(/\]\((\/docs\/([a-z-]+)\/)?#([a-z0-9-]+)\)/g)) {
				const target = match[2] ?? page.name;
				expect([target, anchors.get(target)?.has(match[3] as string)]).toEqual([target, true]);
			}
		},
	);
});
