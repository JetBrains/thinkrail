import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { EXTENSION_API_VERSION, parseExtensionManifest } from "@thinkrail/extension-api/installed";
import type { ExtensionSessionServices } from "@thinkrail/extension-api/server";
import { InstalledExtensions } from "./runtime";
import { tempDir } from "./testFixtures";

const SKILL_DIR = join(import.meta.dir, "../../../skills/making-thinkrail-extensions");
const SCRIPT = join(SKILL_DIR, "scripts/extensions.mjs");
const NODE = Bun.which("node") ?? process.execPath;
const PINNED = new Date("2026-01-01T00:00:00Z");

function exampleFiles(): Record<string, string> {
	const markdown = readFileSync(join(SKILL_DIR, "reference/example.md"), "utf8");
	const files: Record<string, string> = {};
	for (const match of markdown.matchAll(/^### `([^`]+)`\n\n```[a-z]+\n([\s\S]*?)\n```$/gm)) {
		files[match[1] as string] = `${match[2]}\n`;
	}
	return files;
}

const SDK_STUB = {
	"node_modules/@thinkrail/extension-sdk/package.json": JSON.stringify({
		name: "@thinkrail/extension-sdk",
		type: "module",
		exports: { "./server": "./server.js" },
	}),
	"node_modules/@thinkrail/extension-sdk/server.js":
		"export function defineServerExtension(extension) { return extension; }\n",
	"dist/web.js": "export default { name: 'x', toolRenderers: {} };\n",
	"dist/web.css": "",
};

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeExample(): { root: string; folder: string; dataDir: string } {
	const root = tempDir("thinkrail-skill-");
	roots.push(root);
	const folder = join(root, "thinkrail-extensions", "word-count");
	for (const [file, body] of Object.entries({ ...exampleFiles(), ...SDK_STUB })) {
		mkdirSync(dirname(join(folder, file)), { recursive: true });
		writeFileSync(join(folder, file), body);
	}
	const dataDir = join(root, "data");
	mkdirSync(dataDir);
	return { root, folder, dataDir };
}

function runtimeFor(dataDir: string): InstalledExtensions {
	return new InstalledExtensions({
		dataDir,
		reservedNames: () => ["visualize"],
		skillRoots: () => [],
		offline: () => false,
	});
}

async function script(dataDir: string, ...args: string[]) {
	const child = Bun.spawn([NODE, SCRIPT, ...args], {
		env: { ...process.env, THINKRAIL_DATA_DIR: dataDir, THINKRAIL_EXTENSIONS_WAIT_MS: "15000" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { code, stdout, stderr };
}

interface RecordedTool {
	name: string;
	execute: (id: string, params: unknown) => Promise<unknown>;
}

async function registeredTools(runtime: InstalledExtensions): Promise<RecordedTool[]> {
	const tools: RecordedTool[] = [];
	const extension = runtime.records()[0]?.server?.extension;
	const session = { setting: () => true } as unknown as ExtensionSessionServices;
	for (const factory of extension?.sessionExtensions?.(session) ?? []) {
		await factory({ registerTool: (tool: never) => tools.push(tool) } as unknown as ExtensionAPI);
	}
	return tools;
}

describe("the making-thinkrail-extensions skill", () => {
	it("names itself after its folder with a description pi accepts", () => {
		const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
		const frontmatter = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(skill);
		expect(frontmatter?.[1]).toBe("making-thinkrail-extensions");
		expect(frontmatter?.[2]?.length).toBeLessThanOrEqual(1024);
	});

	it("has a worked example whose manifest the host accepts", () => {
		const files = exampleFiles();
		expect(Object.keys(files)).toEqual([
			"package.json",
			".npmrc",
			"server/index.ts",
			"web/index.tsx",
		]);
		const parsed = parseExtensionManifest(JSON.parse(files["package.json"] as string));
		expect(parsed.ok && parsed.manifest).toMatchObject({
			name: "thinkrail-ext-word-count",
			api: EXTENSION_API_VERSION,
			server: "server/index.ts",
			web: "dist/web.js",
			styles: "dist/web.css",
		});
		expect(files["web/index.tsx"]).toContain('name: "thinkrail-ext-word-count"');
	});

	it("has a worked example whose server half loads through the host's loader and runs its tool", async () => {
		const { folder, dataDir } = writeExample();
		writeFileSync(join(dataDir, "extensions.json"), JSON.stringify({ extensions: [folder] }));
		const runtime = runtimeFor(dataDir);
		await runtime.reconcile();
		const record = runtime.records()[0];
		expect(record?.error).toBeUndefined();
		expect(record?.state).toBe("loaded");
		const extension = record?.server?.extension;
		expect(extension?.name).toBe("thinkrail-ext-word-count");
		expect(extension?.settings?.readingTime).toMatchObject({ type: "boolean", default: true });
		const tools = await registeredTools(runtime);
		expect(tools.map((tool) => tool.name)).toEqual(["word_count"]);
		expect(await tools[0]?.execute("call", { text: "one two three\nfour" })).toEqual({
			content: [{ type: "text", text: "4 words, 2 lines, 18 characters, about 1 min to read." }],
			details: { words: 4, lines: 2, characters: 18, readingMinutes: 1 },
		});
	});

	it("installs, reloads and removes through its script while the host watches", async () => {
		const { folder, dataDir } = writeExample();
		const runtime = runtimeFor(dataDir);
		await runtime.reconcile();
		const stop = runtime.watch();
		try {
			expect(JSON.parse((await script(dataDir, "where")).stdout)).toMatchObject({
				dataDir,
				api: EXTENSION_API_VERSION,
			});
			writeFileSync(
				join(dataDir, "extensions.json"),
				JSON.stringify({ extensions: [], note: "kept" }),
			);
			const entry = join(folder, "server", "index.ts");
			utimesSync(entry, PINNED, PINNED);
			const added = await script(dataDir, "add", folder);
			expect(added.code).toBe(0);
			expect(JSON.parse(added.stdout)).toMatchObject({ state: "loaded" });
			expect(JSON.parse(readFileSync(join(dataDir, "extensions.json"), "utf8"))).toEqual({
				extensions: [folder],
				note: "kept",
			});
			writeFileSync(
				entry,
				readFileSync(entry, "utf8").replace('name: "word_count"', 'name: "word_cnt_2"'),
			);
			utimesSync(entry, PINNED, PINNED);
			expect((await script(dataDir, "reload", folder)).code).toBe(0);
			expect((await registeredTools(runtime)).map((tool) => tool.name)).toEqual(["word_cnt_2"]);
			expect((await script(dataDir, "remove", folder)).code).toBe(0);
			expect(runtime.records()).toEqual([]);
			writeFileSync(join(dataDir, "extensions.json"), '{ "extensions": [');
			const refused = await script(dataDir, "add", folder);
			expect(refused.code).toBe(2);
			expect(refused.stderr).toContain("Nothing was written");
			expect(readFileSync(join(dataDir, "extensions.json"), "utf8")).toBe('{ "extensions": [');
		} finally {
			stop();
		}
	}, 60_000);

	it("tells the author which tool names the host keeps", async () => {
		const { folder, dataDir } = writeExample();
		mkdirSync(join(dataDir, "extensions"));
		const entry = { source: folder, state: "loaded", tools: [], shadowed: ["visualize"] };
		writeFileSync(
			join(dataDir, "extensions", "status.json"),
			JSON.stringify({ api: "1.0", updatedAt: new Date().toISOString(), extensions: [entry] }),
		);
		const result = await script(dataDir, "status", folder);
		expect(result.code).toBe(0);
		expect(result.stderr).toBe(
			"Note: ThinkRail keeps its own tool named visualize — rename yours; it never runs.\n",
		);
	});
});
